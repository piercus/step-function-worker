const test = require('ava');
const AWS = require('aws-sdk');
const winston = require('winston');
const StepFunctionWorker = require('../..');
const createActivity = require('../utils/create-activity');
const cleanUp = require('../utils/clean-up');

const stepFunction = new AWS.StepFunctions();
const workerName = 'test worker name';
const stateMachineName = 'test-state-machine-' + Math.floor(Math.random() * 1000);
const activityName = 'test-step-function-worker-' + Math.floor(Math.random() * 1000);

process.on('uncaughtException', err => {
	console.log('uncaughtException', err);
});
/*
{
	definition: '{"Comment":"An Example State machine using Activity.","StartAt":"FirstState","States":{"FirstState":{"Type":"Task","Resource":"arn:aws:states:eu-central-1:170670752151:activity:test-step-function-worker","TimeoutSeconds":300,"HeartbeatSeconds":60,"Next":"End"}}}',
	name: 'test-state-machine',
	roleArn: 'arn:aws:iam::170670752151:role/service-role/StatesExecutionRole-eu-central-1'
}
*/

const context = {};

const before = createActivity.bind(null, {
	context,
	activityName,
	stateMachineName,
	workerName
});
const after = cleanUp.bind(null, context);

const sentInput = function (i) {
	return {
		foo: 'bar',
		index: i
	};
};

const sentOutput = {foo2: 'bar2'};

const taskDurationBase = 500;
const fn = function (event, callback, heartbeat) {
	heartbeat();

	const totalDuration = Math.ceil(Math.random() * taskDurationBase);
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		heartbeat();
	}, totalDuration);
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		heartbeat();
	}, 2 * totalDuration);
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		heartbeat();
	}, 3 * totalDuration);
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		heartbeat();
	}, 4 * totalDuration);
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		heartbeat();
	}, 5 * totalDuration);
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		callback(null, sentOutput);
	}, 6 * totalDuration);
};

test.before(before);

test.serial('Step function Activity Worker with 200 parallel tasks and heartbeat', t => {
	const {activityArn, stateMachineArn} = context;
	const startDate = new Date();
	const totalTasks = 10;
	const poolConcurrency = 3;
	const taskConcurrency = 5;
	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-fn',
		fn,
		logger: new winston.Logger({
			level: 'debug',
			transports: [
				new (winston.transports.Console)({
					timestamp() {
						return (new Date()).toISOString().slice(11);
					},
					formatter(options) {
						// - Return string will be passed to logger.
						// - Optionally, use options.colorize(options.level, <string>) to
						//   colorize output based on the log level.
						return options.timestamp() + ' ' +
							winston.config.colorize(options.level, options.level.toUpperCase()) + ' ' +
							(options.message ? options.message : '') +
							(options.meta && Object.keys(options.meta).length > 0 ? '\n\t' + JSON.stringify(options.meta) : '');
					}
				})
			]
		}),
		poolConcurrency,
		taskConcurrency
	});

	const params = function (i) {
		return {
			stateMachineArn,
			input: JSON.stringify(sentInput(i))
		};
	};

	let count = 0;
	let countFull = 0;
	worker.on('task', () => {
		count++;
	});
	worker.on('full', () => {
		countFull++;
		const report = worker.report();
		t.is(report.tasks.length, taskConcurrency);
	});
	const promises = [];
	for (let i = 0; i < totalTasks; i++) {
		promises.push(stepFunction.startExecution(params(i)).promise());
	}

	return new Promise((resolve, reject) => {
		worker.once('empty', () => {
			t.is(count, totalTasks);
			// T.is(Math.abs(countFull - (totalTasks-taskConcurrency))/totalTasks)
			const endDate = new Date();
			worker.logger.info(`Spent ${(endDate - startDate) / 1000} seconds`);
			worker.close(() => {
				resolve();
			});
		});
		worker.on('error', reject);

		return Promise.all(promises);
	});
});

test.after(after);
