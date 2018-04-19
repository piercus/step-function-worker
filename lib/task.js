const EventEmitter = require('events').EventEmitter;
const util = require('util');

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
	this.input = options.input;
	this.taskToken = options.taskToken;
	this.workerName = options.workerName;
	this.startTime = new Date();
	this.worker.execute(this.input, this.taskCallback.bind(this), this.heartbeat.bind(this));
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
	this.worker.succeed({
		output: res,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
	this.emit('finish');
};

Task.prototype.fail = function (err) {
	this.worker.fail({
		error: err,
		taskToken: this.taskToken,
		workerName: this.workerName
	});
	this.emit('finish');
};

Task.prototype.heartbeat = function () {
	this.worker.heartbeat({
		taskToken: this.taskToken,
		workerName: this.workerName
	});
};

util.inherits(Task, EventEmitter);

module.exports = Task;
