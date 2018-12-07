const {test} = require('ava');
const AWS = require('aws-sdk');
const winston = require('winston');

const StepFunctionWorker = require('../..');
const createActivity = require('../utils/create-activity');
const cleanUp = require('../utils/clean-up');

const stepFunction = new AWS.StepFunctions();

const logger = new winston.Logger({
	transports: [new winston.transports.Console({
		level: 'debug'
	})]
});

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

const before = createActivity.bind(null, {context, activityName, stateMachineName, workerName});
const after = cleanUp.bind(null, {context, activityName, stateMachineName, workerName});

const sentInput = {foo: 'bar'};

const fnError = function (event, callback, heartbeat) {
	heartbeat();
	setTimeout(() => {
		const err = new Error('custom error');
		// Assert.equal(event, sentInput);
		callback(err);
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
		const params = {
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
		stepFunction.startExecution(params).promise();
	});
});

test.after(after);

