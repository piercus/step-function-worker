const crypto = require('crypto');

/**
* @class Pooler
* @param {object} options
* @param {string} options.activityArn
* @param {string} [options.workerName=null]
* @param {string} options.logger
* */

function Pooler(options) {
	this.id = crypto.randomBytes(3).toString('hex');
	this.logger = options.logger;
	this.startTime = new Date();
	this.activityArn = options.activityArn;
	this.worker = options.worker;
	this.index = options.index;
	this.workerName = options.workerName && (options.workerName + '-' + this.index);
	this.logger.debug(`new pooler ${this.id}`);
	this.getActivityTask();
}

Pooler.prototype.stop = async function () {
	this.logger.debug(`Pooler (${this.id}): Stop`);

	if (this._requestPromise) {
		await this._requestPromise;
	}

	this._stopped = true;
};

/**
* @typedef {object} PoolerReport
* @param {String} workerName
* @param {String} status, can be 'Task under going', 'Waiting for Tasks' or 'Paused'
* @param {TaskReport | null} task
*/
/**
* Get a report on the actual situation of the pooler
* @return {PoolerReport} list of poolers
*/
Pooler.prototype.report = function () {
	return {
		id: this.id,
		startTime: this.startTime,
		status: (this._stopped ? 'Stopped' : 'Running')
	};
};

Pooler.prototype.restart = async function () {
	await this.stop();
	this._stopped = false;
	this.getActivityTask();
};

Pooler.prototype.getActivityTask = async function () {
	// This.logger.info('getActivityTask');

	// this.logger.debug(this.workerName + ' getActivityTask ' + this.activityArn);
	if (this._stopped) {
		return Promise.reject(new Error(`Pooler (${this.id}) is stopped`));
	}

	if (!this._requestPromise) {
		this.logger.debug(`Pooler (${this.id}): getActivityTask`);

		this._requestPromise = this.worker.stepfunction.getActivityTask({
			activityArn: this.activityArn,
			workerName: this.workerName
		}).promise();

		try {
			const data = await this._requestPromise;

			if (data.taskToken && typeof (data.taskToken) === 'string' && data.taskToken.length > 1) {
				this.logger.debug(`Pooler (${this.id}): Activity task received (${data.taskToken.slice(0, 10)})`);
				this.worker.addTask({
					...data,
					input: JSON.parse(data.input),
					workerName: this.workerName,
					poolerId: this.id
				});
			} else {
				this.logger.debug(`Pooler (${this.id}): No activity task received`);
			}

			this._requestPromise = null;
			const renewal = this.worker.renewPooler(this);
			if (renewal) {
				await this.getActivityTask();
			} else {
				this.stop();
				this.worker.removePooler(this);
			}
		} catch (error) {
			this.logger.error(`Pooler (${this.id}):`, error);
			if (error.code === 'RequestAbortedError') {
			// In case of abort, close silently
			} else {
				this.worker.emit('error', error);
			}
		}
	}
};

module.exports = Pooler;
