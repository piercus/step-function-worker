const {EventEmitter} = require('events');
const {inherits} = require('util');
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

Task.prototype.taskCallback = function (error, result) {
	if (error) {
		this.logger.debug('task fail');
		this.fail(error);
	} else {
		this.logger.debug('task succeed');
		this.succeed(result);
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

Task.prototype.succeed = function (result) {
	this.logger.debug(`Succeed (${this.input.index})`);
	this._succeed({
		input: this.input,
		output: result,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
	this._finished = true;
	this.emit('finish');
};

Task.prototype.fail = function (error) {
	this._fail({
		error,
		input: this.input,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
	this._finished = true;
	this.emit('finish');
};

Task.prototype.heartbeat = function () {
	this.logger.debug(`Heartbeat (${this.input.index})`);

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

Task.prototype._succeed = function (result) {
	const parameters = {...result, output: JSON.stringify(result.output)};
	delete parameters.workerName;
	delete parameters.input;
	this.stepfunction.sendTaskSuccess(parameters, error => {
		if (error) {
			this.logger.error('Cannot sendTaskSuccess', error);
			this.worker.emit('error', {err: error, input: result.input});
		} else {
			this.worker.emit('success', result);
		}
	});
};

Task.prototype._fail = function (result) {
	let error = JSON.stringify(result.error, replaceError);

	if (error.length > 256) {
		// Otherwise aws sdk will tell
		// failed to satisfy constraint: Member must have length less than or equal to 256
		error = error.slice(0, 253) + '...';
	}

	const parameters = {...result, error};
	delete parameters.workerName;
	delete parameters.input;
	// This.logger.debug('sendTaskFailure', res.error);
	this.stepfunction.sendTaskFailure(parameters, error_ => {
		if (error_) {
			this.worker.emit('error', {err: error_, input: result.input});
		} else {
			this.worker.emit('failure', result);
		}
	});
};

Task.prototype._heartbeat = function (result) {
	const parameters = {...result};
	delete parameters.workerName;
	delete parameters.input;
	// This.logger.debug('sendTaskHeartbeat');

	this.stepfunction.sendTaskHeartbeat(parameters, error => {
		if (error) {
			if (error.code === 'TaskTimedOut' && this._finished) {
				this.logger.warn(
					`Heartbeat response received after task is finished (succeed or failed)
					To remove this warning make sure to not send heartbeat() just before calling cb()`
				);
			} else {
				this.worker.emit('error', {err: error, input: result.input});
			}
		} else {
			this.worker.emit('heartbeat', result);
		}
	});
};

inherits(Task, EventEmitter);

module.exports = Task;
