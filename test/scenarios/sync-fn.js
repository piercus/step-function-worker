const test = require('ava');
const AWS = require('aws-sdk');
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

const before = createActivity.bind(null, {context, activityName, stateMachineName, workerName});
const after = cleanUp.bind(null, context);

const sentInput = {foo: 'bar'};
const sentOutput = {foo2: 'bar2'};

const fn = function (event, callback) {
	callback(null, sentOutput);
};

const fnError = function () {
	throw (new Error('custom error'));
};

test.before(before);

test.serial('Step function Activity Worker with 2 consecutive synchronous tasks', t => {
	const {activityArn, stateMachineArn} = context;

	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-fn',
		fn
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
		worker.on('error', reject);
		worker.once('success', out => {
			t.is(out.taskToken, expectedTaskToken);

			let expectedTaskToken2;
			worker.once('task', task => {
				// Task.taskToken
				// task.input
				expectedTaskToken2 = task.taskToken;
			});

			worker.once('success', out => {
				t.is(out.taskToken, expectedTaskToken2);
				worker.close(() => {
					resolve();
				});
			});

			stepFunction.startExecution(params).promise();
		});

		stepFunction.startExecution(params).promise();
	});
});

test.serial('Step function Activity Worker with synchronous failing task', t => {
	const {activityArn, stateMachineArn} = context;

	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-fn',
		fn: fnError
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
		worker.once('success', reject);
		stepFunction.startExecution(params).promise();
	});
});
test.after(after);
