const {EventEmitter} = require('events');
const util = require('util');
const replaceError = require('./replace-error.js');

/**
* @class StepFunctionWorker
* @param {object} options
* @param {object} options.worker
* @param {string} options.taskToken
* @param {string} options.logger
* @param {string} options.workerName - this.pooler workerName
* @param {object} options.input
* */

function Task(options) {
	EventEmitter.call(this);

	this.logger = options.logger;
	this.worker = options.worker;
	this.stepfunction = this.worker.stepfunction;
	this.input = options.input;
	this.taskToken = options.taskToken;
	this.workerName = options.workerName;
	this.startTime = new Date();
	this._finished = false;
	this._execute(this.input, this.taskCallback.bind(this), this.heartbeat.bind(this));
}

Task.prototype.taskCallback = function (err, res) {
	if (err) {
		this.logger.debug('task fail');
		this.fail(err);
	} else {
		this.logger.debug('task succeed');
		this.succeed(res);
	}
};
/**
* @typedef {object} TaskReport
* @param {String} taskToken
* @param {object} input
* @param {Date} startTime
*/

/**
* Get a report on the actual situation of the task
* @return {TaskReport}
*/

Task.prototype.report = function () {
	return {
		taskToken: this.taskToken,
		input: this.input,
		startTime: this.startTime
	};
};

Task.prototype.succeed = function (res) {
	this.logger.debug(`Succeed (${this.input.index})`)
	this._succeed({
		input: this.input,
		output: res,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
	this._finished = true;
};

Task.prototype.fail = function (err) {
	this._fail({
		error: err,
		input: this.input,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
	this._finished = true;
};

Task.prototype.heartbeat = function () {
	this.logger.debug(`Heartbeat (${this.input.index})`)
	
	this._heartbeat({
		input: this.input,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
};


Task.prototype._execute = function (input, cb, heartbeat) {
	setImmediate(() => {
		try {
			this.worker.fn(input, cb, heartbeat);
		} catch (error) {
			cb(error);
		}
	});
};

Task.prototype._succeed = function (res) {
	const params = Object.assign({}, res, {output: JSON.stringify(res.output)});
	delete params.workerName;
	delete params.input;
	this.stepfunction.sendTaskSuccess(params, err => {
		if (err) {
			this.logger.error(`Cannot sendTaskSuccess`, err)
			this.worker.emit('error', {err, input: res.input});
		} else {
			this.worker.emit('success', res);
		}
	});
};

Task.prototype._fail = function (res) {
	let error = JSON.stringify(res.error, replaceError);

	if (error.length > 256) {
		// Otherwise aws sdk will tell
		// failed to satisfy constraint: Member must have length less than or equal to 256
		error = error.slice(0, 253) + '...';
	}

	const params = Object.assign({}, res, {error});
	delete params.workerName;
	delete params.input;
	//this.logger.debug('sendTaskFailure', res.error);
	this.stepfunction.sendTaskFailure(params, err => {
		if (err) {
			this.worker.emit('error', {err, input: res.input});
		} else {
			this.worker.emit('failure', res);
		}
	});
};

Task.prototype._heartbeat = function (res) {
	const params = Object.assign({}, res);
	delete params.workerName;
	delete params.input;
	//this.logger.debug('sendTaskHeartbeat');

	this.stepfunction.sendTaskHeartbeat(params, err => {
		if (err) {
			if(err.code === 'TaskTimedOut' && this._finished){
				this.logger.warn(
					`Heartbeat response received after task is finished (succeed or failed)
					To remove this warning make sure to not send heartbeat() just before calling cb()`
				);
			} else {
				this.worker.emit('error', {err, input: res.input});
			}
		} else {
			this.worker.emit('heartbeat', res);
		}
	});
};

util.inherits(Task, EventEmitter);

module.exports = Task;
