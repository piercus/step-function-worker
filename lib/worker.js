const EventEmitter = require('events').EventEmitter;
const util = require('util');
const AWS = require('aws-sdk');

const Pooler = require('./pooler.js');
const replaceError = require('./replace-error.js');

/**
* @class Worker
* @param {object} options
* @param {string} options.activityArn
* @param {string} [options.region='us-west-2']
* @param {string} [options.workerName=null]
* @param {function} [options.fn=null]
* @param {boolean} [options.autoStart=true]
* @param {boolean} [options.logger=null] winston-like logger
* @param {string} [options.concurrency=1]
* */

function Worker(options) {
	EventEmitter.call(this);

	this.autoStart = typeof (options.autoStart) === 'boolean' ? options.autoStart : true;

	if (!options.activityArn) {
		this.emit('error', new Error('activityArn is mandatory inside Worker'));
		return;
	}

	this.region = typeof (options.region) === 'string' ? options.region : 'us-west-2';
	this.concurrency = typeof (options.concurrency) === 'number' ? options.concurrency : 1;
	this.stepfunction = new AWS.StepFunctions({region: this.region});
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

	if (this.autoStart) {
		setTimeout(() => {
			this.start(() => {
				// Do nothing
				this.emit('ready');
			});
		}, 0);
	}
}

Worker.prototype.start = function (cb) {
	this.updatePool(cb);
};

Worker.prototype.report = function () {
	return this.poolers.map(pooler => {
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
		region: this.region,
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

Worker.prototype.close = function (cb) {
	this.concurrency = 0;
	this.updatePool(cb);
	this.removeAllListeners();
};

Worker.prototype.execute = function (input, cb, heartbeat) {
	if (typeof (this.fn) === 'function') {
		this.fn(input, cb, heartbeat);
	} else {
		cb(new Error('worker does not define any function'));
	}
};

Worker.prototype.succeed = function (res) {
	const params = Object.assign({}, res, {output: JSON.stringify(res.output)});
	delete params.workerName;
	this.stepfunction.sendTaskSuccess(params, err => {
		if (err) {
			this.emit('error', err);
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
	this.logger.debug('sendTaskFailure', res.error);
	this.stepfunction.sendTaskFailure(params, err => {
		if (err) {
			this.emit('error', err);
		} else {
			this.emit('failure', res);
		}
	});
};

Worker.prototype.heartbeat = function (res) {
	const params = Object.assign({}, res);
	delete params.workerName;
	this.logger.debug('sendTaskHeartbeat');

	this.stepfunction.sendTaskHeartbeat(params, err => {
		if (err) {
			this.emit('error', err);
		} else {
			this.emit('heartbeat', res);
		}
	});
};

util.inherits(Worker, EventEmitter);

module.exports = Worker;
