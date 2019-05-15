const {EventEmitter} = require('events');
const util = require('util');
const AWS = require('aws-sdk');
const parser = require('aws-arn-parser');

const Pooler = require('./pooler.js');
const Task = require('./task.js');

/**
* @typedef {Object} AWSConfig see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html
*/
/**
* @class Worker
* @param {object} options
* @param {string} options.activityArn
* @param {string} [options.workerName=null]
* @param {function} [options.fn=null]
* @param {boolean} [options.autoStart=true]
* @param {boolean} [options.logger=null] winston-like logger
* @param {string} [options.concurrency=1]
* @param {AWSConfig} [options.awsConfig={}]
* */

function Worker(options) {
	EventEmitter.call(this);
	const awsConfig = options.awsConfig || {};
	this.stepfunction = new AWS.StepFunctions(awsConfig);

	this.autoStart = typeof (options.autoStart) === 'boolean' ? options.autoStart : true;

	if (!options.activityArn) {
		throw (new Error('activityArn is mandatory inside Worker'));
	}

	if (typeof (options.concurrency) === 'number') {
		throw (new TypeError('step-function-worker is not supporting `concurrency` parameter since version 3.0, see README.md'));
	}

	this.poolConcurrency = typeof (options.poolConcurrency) === 'number' ? options.poolConcurrency : 1;
	this.taskConcurrency = typeof (options.taskConcurrency) === 'number' ? options.taskConcurrency : null;

	this.activityArn = options.activityArn;
	this.workerName = options.workerName;
	this.logger = options.logger || {
		debug() {},
		info() {},
		warn: console.warn,
		error: console.error
	};
	this.fn = options.fn;
	this._poolers = [];
	this._tasks = [];

	if (typeof (this.fn) !== 'function') {
		throw (new TypeError('worker does not define any function'));
	}

	const {region} = parser(options.activityArn);

	if (typeof (region) === 'string' && (this.stepfunction.config.region !== region)) {
		throw (new Error(`activity ARN region (${region}) should match with AWS Region (${this.stepfunction.config.region})`));
	}

	if (this.autoStart) {
		setImmediate(() => {
			this.start()
				.then(() => {
					// Do nothing
					this.emit('ready');
				})
				.catch(error => {
					this.logger.error('Worker failed to start', error);
					this.emit('error', error);
				});
		});
	}
}

/**
* Start the worker pooling for new tasks
* @param {function} cb callback(err)
* @returns {Promise}
*/
Worker.prototype.start = function () {
	this.increasePool();
	this.logger.info('Worker started');
	return Promise.resolve();
};

/**
* Get a report of the actual situation of the worker
* @return {Array.<PoolerReport>} list of poolers
*/
Worker.prototype.report = function () {
	return {
		poolers: this._poolers.map(pooler => {
			return pooler.report();
		}),
		tasks: this._tasks.map(task => {
			return task.report();
		})
	};
};

Worker.prototype.renewPooler = function (pooler) {
	const maxNumberOfPools = this.getMaxNumberOfPools();

	if (this._poolers.length > maxNumberOfPools) {
		const index = this._poolers.indexOf(pooler);
		if (index === -1) {
			throw (new Error('cannot removed non-listed pooler'));
		}

		return false;
	}

	this.increasePool();
	return true;
};

Worker.prototype.getMaxNumberOfPools = function () {
	let maxNumberOfPools = this.poolConcurrency;
	if (typeof (this.taskConcurrency) === 'number') {
		maxNumberOfPools = Math.min(this.taskConcurrency - this._tasks.length, this.poolConcurrency);
	}

	if (maxNumberOfPools < 0) {
		throw (new Error(`maxNumberOfPools (${maxNumberOfPools}) should be positive`));
	}

	return maxNumberOfPools;
};

Worker.prototype.increasePool = function () {
	const maxNumberOfPools = this.getMaxNumberOfPools();
	this.logger.debug('increasePool started', maxNumberOfPools, this._poolers.length);

	if (this._poolers.length < maxNumberOfPools) {
		this.addPooler(this._poolers.length);
		return this.increasePool();
	}

	if (this._poolers.length > maxNumberOfPools) {
		return false;
	}

	return true;
};

Worker.prototype.addTask = function (params) {
	// This.logger.count('addTask');
	const task = new Task(Object.assign({}, params, {worker: this, logger: this.logger}));
	this._tasks.push(task);
	this.emit('task', params);
	task.on('finish', () => {
		// This.logger.count('finishTask');
		const index = this._tasks.indexOf(task);
		if (index === -1) {
			throw (new Error('tasks is not registered in _tasks'));
		}

		this._tasks.splice(index, 1);
		this.updateTasks();
		this.increasePool();
	});
	this.updateTasks();
};

Worker.prototype.updateTasks = function () {
	if (typeof (this.taskConcurrency) === 'number') {
		if (this._tasks.length === this.taskConcurrency) {
			this.emit('full');
		} else if (this._tasks.length > this.taskConcurrency) {
			throw (new Error(`Should not reach ${this._tasks.length} tasks`));
		}
	}

	if (this._tasks.length === 0) {
		this.logger.info('empty');
		this.emit('empty');
	}
};

Worker.prototype.addPooler = function (index) {
	this.logger.debug('addPooler');
	const pooler = new Pooler({
		activityArn: this.activityArn,
		workerName: this.workerName,
		worker: this,
		logger: this.logger,
		index
	});

	this._poolers.push(pooler);
};

Worker.prototype.removePooler = function (pooler) {
	this.logger.debug('removePooler');

	const index = this._poolers.indexOf(pooler);
	if (index === -1) {
		throw (new Error(`pooler ${pooler} is not in the pooler list`));
	}

	this._poolers.splice(index, 1);

	if (this._poolers.length === 0) {
		this.emit('empty-poolers');
	}
};

// Worker.prototype.removePooler = function () {
// 	if(!this._poolerRemovalPromise){
// 		this._poolerRemovalPromise = Promise.resolve()
// 		.then(() => {
// 			this.logger.debug('removePooler started')
// 			const removedPooler = this._poolers[this._poolers.length -1];
// 			const id = Math.random();
// 			const _this = this;
// 			return removedPooler.stop()
// 		}).then(() => {
// 			const index = _this._poolers.indexOf(removedPooler);
// 			if(index === -1){
// 				throw(new Error('cross poolers removal is not expected'))
// 			}
// 			_this._poolers.splice(index, 1);
// 			return _this._poolers
// 		}).then(r => {
// 			this.logger.debug('removePooler ended')
//
// 			this._poolerRemovalPromise = null
// 			return r;
// 		})
// 	}
//
// 	return this._poolerRemovalPromise;
// };

/**
* Close the worker, this function might take 60 seconds to finish to do step function design
* remove all the events attached to the worker
* @param {function} callback
*/

Worker.prototype.close = function (cb) {
	this.removeAllListeners();
	const promise = this.stop();

	if (cb) {
		promise.then(() => cb()).catch(cb);
	} else {
		return promise;
	}
};

/**
* Stop the worker
* But does not remove all the events attached to it
* NB: worker.concurrency is set to 0
* @param {function} callback
*/

Worker.prototype.stop = function () {
	this.logger.info('Stopping the worker ... this might take 60 seconds');
	this.poolConcurrency = 0;
	if (!this._stoppingPromise) {
		this._stoppingPromise = new Promise((resolve, reject) => {
			const onEmpty = () => {
				this.logger.info('Worker stopped');
				if (this._tasks.length > 0) {
					const err = new Error('Some tasks are still ongoing, please make sure all the tasks are finished before stopping the worker');
					return reject(err);
				}

				return resolve();
			};

			if (this._poolers.length === 0) {
				onEmpty();
			}

			this.once('empty-poolers', () => {
				onEmpty();
			});
		});
	}

	return this._stoppingPromise;
};

Worker.prototype.restart = function (cb) {
	const oldPoolConcurrency = this.poolConcurrency;
	return this.stop().then(() => {
		this.poolConcurrency = oldPoolConcurrency;
		return this.start(cb);
	});
};

util.inherits(Worker, EventEmitter);

module.exports = Worker;
