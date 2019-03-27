const {EventEmitter} = require('events');
const util = require('util');
const AWS = require('aws-sdk');
const parser = require('aws-arn-parser');

const Pooler = require('./pooler.js');
const replaceError = require('./replace-error.js');
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

	this.concurrency = typeof (options.concurrency) === 'number' ? options.concurrency : 1;

	this.activityArn = options.activityArn;
	this.workerName = options.workerName;
	this.logger = options.logger || {
		debug() {},
		info: console.log,
		warn: console.warn,
		error: console.error
	};
	this.fn = options.fn;
	this._poolers = [];

	if (typeof (this.fn) !== 'function') {
		throw (new TypeError('worker does not define any function'));
	}

	const {region} = parser(options.activityArn);

	if (typeof (region) === 'string' && (this.stepfunction.config.region !== region)) {
		throw (new Error(`activity ARN region (${region}) should match with AWS Region (${this.stepfunction.config.region})`));
	}

	if (this.autoStart) {
		setImmediate(() => {
			this.start(() => {
				// Do nothing
				this.emit('ready');
			});
		});
	}
}

/**
* Start the worker pooling for new tasks
* @param {function} cb callback(err)
*/
Worker.prototype.start = function (cb) {
	this.updatePool(err => {
		this.logger.info('Worker started');
		cb(err);
	});
};

/**
* Get a report of the actual situation of the worker
* @return {Array.<PoolerReport>} list of poolers
*/
Worker.prototype.report = function () {
	return this._poolers.map(pooler => {
		return pooler.report();
	});
};

Worker.prototype.updatePool = function (cb) {
	if (this._poolers.length < this.concurrency) {
		this.addPooler(this._poolers.length);
		this.updatePool(cb);
	} else if (this._poolers.length > this.concurrency) {
		this.removePooler(() => {
			this.updatePool(cb);
		});
	} else {
		cb();
	}
};

Worker.prototype.addPooler = function (index) {
	const pooler = new Pooler({
		activityArn: this.activityArn,
		workerName: this.workerName,
		worker: this,
		logger: this.logger,
		index
	});

	pooler.on('error', err => {
		this.emit('error', err);
	});

	this._poolers.push(pooler);
};

Worker.prototype.removePooler = function (cb) {
	const removedPooler = this._poolers.pop();
	removedPooler.stop(cb);
};

/**
* Close the worker, this function might take 60 seconds to finish to do step function design
* remove all the events attached to the worker
* @param {function} callback
*/

Worker.prototype.close = function (cb) {
	this.stop(cb);
	this.removeAllListeners();
};

/**
* Stop the worker
* But does not remove all the events attached to it
* NB: worker.concurrency is set to 0
* @param {function} callback
*/

Worker.prototype.stop = function (cb) {
	this.logger.info('Stopping the worker ... this might take 60 seconds');
	this.concurrency = 0;
	this.updatePool(err => {
		this.logger.info('Worker stopped');
		cb(err);
	});
};

Worker.prototype.restart = function (cb) {
	const oldConcurrency = this.concurrency;
	this.stop(err => {
		if (err) {
			return cb(err);
		}

		this.concurrency = oldConcurrency;
		this.start(cb);
	});
};

Worker.prototype.execute = function (input, cb, heartbeat) {
	setImmediate(() => {
		try {
			this.fn(input, cb, heartbeat);
		} catch (error) {
			cb(error);
		}
	});
};

Worker.prototype.succeed = function (res) {
	const params = Object.assign({}, res, {output: JSON.stringify(res.output)});
	delete params.workerName;
	delete params.input;
	this.stepfunction.sendTaskSuccess(params, err => {
		if (err) {
			this.emit('error', {err, input: res.input});
		} else {
			this.emit('success', res);
		}
	});
};

Worker.prototype.fail = function (res) {
	let error = JSON.stringify(res.error, replaceError);

	if (error.length > 256) {
		// Otherwise aws sdk will tell
		// failed to satisfy constraint: Member must have length less than or equal to 256
		error = error.slice(0, 253) + '...';
	}

	const params = Object.assign({}, res, {error});
	delete params.workerName;
	delete params.input;
	this.logger.debug('sendTaskFailure', res.error);
	this.stepfunction.sendTaskFailure(params, err => {
		if (err) {
			this.emit('error', {err, input: res.input});
		} else {
			this.emit('failure', res);
		}
	});
};

Worker.prototype.heartbeat = function (res) {
	const params = Object.assign({}, res);
	delete params.workerName;
	delete params.input;
	this.logger.debug('sendTaskHeartbeat');

	this.stepfunction.sendTaskHeartbeat(params, err => {
		if (err) {
			this.emit('error', {err, input: res.input});
		} else {
			this.emit('heartbeat', res);
		}
	});
};

util.inherits(Worker, EventEmitter);

module.exports = Worker;
