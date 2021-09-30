const test = require('ava');
const AWS = require('aws-sdk');
const winston = require('winston');

const StepFunctionWorker = require('../../index.js');
const createActivity = require('../utils/create-activity.js');
const cleanUp = require('../utils/clean-up.js');

const stepFunction = new AWS.StepFunctions();

const logger = winston.createLogger({
	transports: [new winston.transports.Console({
		level: 'debug'
	})]
});

const workerName = 'test worker name';
const stateMachineName = 'test-state-machine-' + Math.floor(Math.random() * 100000);
const activityName = 'test-step-function-worker-' + Math.floor(Math.random() * 100000);

process.on('uncaughtException', error => {
	console.log('uncaughtException', error);
});
/*
{
	definition: '{"Comment":"An Example State machine using Activity.","StartAt":"FirstState","States":{"FirstState":{"Type":"Task","Resource":"arn:aws:states:eu-central-1:170670752151:activity:test-step-function-worker","TimeoutSeconds":300,"HeartbeatSeconds":60,"Next":"End"}}}',
	name: 'test-state-machine',
	roleArn: 'arn:aws:iam::170670752151:role/service-role/StatesExecutionRole-eu-central-1'
}
*/

const context = {};

const before = createActivity.bind(null, {context, activityName, stateMachineName, workerName});
const after = cleanUp.bind(null, {context, activityName, stateMachineName, workerName});

const sentInput = {foo: 'bar'};

const fnError = function (event, callback, heartbeat) {
	heartbeat();
	setTimeout(() => {
		const error = new Error('custom error');
		// Assert.equal(event, sentInput);
		callback(error);
	}, 2000);
};

test.before(before);

test.serial('Step function Activity Worker with A failing worker', t => {
	const {activityArn, stateMachineArn} = context;

	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-fn',
		fn: fnError,
		logger
	});

	return new Promise((resolve, reject) => {
		let expectedTaskToken;
		const parameters = {
			stateMachineArn,
			input: JSON.stringify(sentInput)
		};
		worker.once('task', task => {
			// Task.taskToken
			// task.input
			t.deepEqual(task.input, sentInput);
			t.is(typeof (task.taskToken), 'string');
			expectedTaskToken = task.taskToken;
		});

		worker.once('failure', out => {
			t.is(out.taskToken, expectedTaskToken);
			t.is(out.error.message, 'custom error');
			worker.close(() => {
				resolve();
			});
		});

		worker.on('success', reject);
		stepFunction.startExecution(parameters).promise();
	});
});

test.after(after);

