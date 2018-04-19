const test = require('ava').test;
const PromiseBlue = require('bluebird');
const AWS = require('aws-sdk');
const StepFunctionWorker = require('../../index.js');
const createActivity = require('../utils/create-activity');
const cleanUp = require('../utils/clean-up');

const stepfunction = new AWS.StepFunctions();
const stepFunctionPromises = PromiseBlue.promisifyAll(stepfunction);
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

const fn = function (event, callback, heartbeat) {
	heartbeat();
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		callback(null, sentOutput);
	}, 2000);
};

const fn2 = function (event, callback, heartbeat) {
	heartbeat();
	setTimeout(() => {
		// Assert.equal(event, sentInput);
		callback(null, Object.assign({}, event, sentOutput));
	}, 2000);
};

test.before(before);

test.serial('Step function Activity Worker with 2 consecutive tasks', t => {
	const activityArn = context.activityArn;
	const stateMachineArn = context.stateMachineArn;

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

			stepFunctionPromises.startExecutionAsync(params);
		});

		stepFunctionPromises.startExecutionAsync(params);
	});
});

test.serial('Step function with 3 concurrent worker', t => {
	const activityArn = context.activityArn;
	const stateMachineArn = context.stateMachineArn;

	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-concurrent',
		fn: fn2,
		concurrency: 3
	});
	const params1 = {
		stateMachineArn,
		input: JSON.stringify({inputNumber: '0'})
	};
	const params2 = {
		stateMachineArn,
		input: JSON.stringify({inputNumber: '1'})
	};
	const params3 = {
		stateMachineArn,
		input: JSON.stringify({inputNumber: '2'})
	};

	return new Promise((resolve, reject) => {
		let countTask = 0;
		let countSuccess = 0;
		const workerNames = [];
		const startDate = new Date();
		const onTask = function (task) {
			// Task.taskToken
			// task.input
			// task.workerName
			countTask++;

			if (workerNames.indexOf(task.workerName) === -1) {
				workerNames.push(task.workerName);
			}
			if (countTask === 3) {
				worker.removeListener('task', onTask);
				t.is(workerNames.length, 3);
			}
		};

		const onSuccess = function (out) {
			countSuccess++;
			if (workerNames.indexOf(out.workerName) === -1) {
				t.fail('workerName should have been seen on task event before');
			}
			if (countSuccess === 1) {
				const report = worker.report();
				t.is(report.length, 3);
				t.is(report.filter(p => p.status === 'Task under going'), 2);
			}
			if (countSuccess === 3) {
				worker.removeListener('success', onSuccess);
				const endDate = new Date();
				t.true((endDate - startDate) / 1000 < 3.9);
				t.true((endDate - startDate) / 1000 > 2);
				worker.close(() => {
					t.is(worker._poolers.length, 0);
					resolve();
				});
			}
		};

		worker.on('success', onSuccess);
		worker.on('task', onTask);
		worker.on('error', reject);
		stepFunctionPromises.startExecutionAsync(params1);
		stepFunctionPromises.startExecutionAsync(params2);
		stepFunctionPromises.startExecutionAsync(params3);
	});
});

test.after(after);

