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

Pooler.prototype.stop = function () {
	this.logger.debug(`Pooler (${this.id}): Stop`);

	if (!this._stoppingPromise) {
		this._stoppingPromise = (this._requestPromise || Promise.resolve()).then(() => {
			this._stopped = true;
		});
	}

	return this._stoppingPromise;
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

Pooler.prototype.restart = function () {
	return this.stop().then(() => {
		this._stopped = false;
		this.getActivityTask();
		return null;
	});
};

Pooler.prototype.getActivityTask = function () {
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
		}).promise()
			.then(data => {
				if (data.taskToken && typeof (data.taskToken) === 'string' && data.taskToken.length > 1) {
					this.logger.debug(`Pooler (${this.id}): Activity task received (${data.taskToken.slice(0, 10)})`);
					const params = Object.assign({}, data, {
						input: JSON.parse(data.input),
						workerName: this.workerName,
						poolerId: this.id
					});
					return this.worker.addTask(params);
				}

				this.logger.debug(`Pooler (${this.id}): No activity task received`);
				return null;
			})
			.then(() => {
				this._requestPromise = null;
				const renewal = this.worker.renewPooler(this);
				if (!renewal) {
					this.stop();
					this.worker.removePooler(this);
					return null;
				}

				return this.getActivityTask();
			})
			.catch(error => {
			// Console.log(err);
				this.logger.error(`Pooler (${this.id}):`, error);
				if (error.code === 'RequestAbortedError') {
				// In case of abort, close silently
				} else {
					this.worker.emit('error', error);
				}

			// Return Promise.reject(err);
			});
	}

	return this._requestPromise;
};

module.exports = Pooler;
