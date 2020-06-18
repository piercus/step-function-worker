const test = require('ava');
const AWS = require('aws-sdk');
const StepFunctionWorker = require('../..');
const createActivity = require('../utils/create-activity');
const cleanUp = require('../utils/clean-up');

const stepFunction = new AWS.StepFunctions();
const workerName = 'test worker name';
const stateMachineName = 'test-state-machine-' + Math.floor(Math.random() * 100000);
const activityName = 'test-step-function-worker-' + Math.floor(Math.random() * 100000);

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

test.serial('Step function with 3 poolConcurrency worker', t => {
	const {activityArn, stateMachineArn} = context;

	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-poolConcurrency',
		fn: fn2,
		poolConcurrency: 3
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
				t.is(report.poolers.length, 3);
				t.is(report.tasks.length, 0);
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
		stepFunction.startExecution(params1).promise();
		stepFunction.startExecution(params2).promise();
		stepFunction.startExecution(params3).promise();
	});
});

test.serial('Restart the worker', t => {
	const {activityArn, stateMachineArn} = context;

	const worker = new StepFunctionWorker({
		activityArn,
		workerName: workerName + '-restart',
		fn: fn2,
		poolConcurrency: 1
	});
	const params1 = {
		stateMachineArn,
		input: JSON.stringify({inputNumber: '0'})
	};
	const params2 = {
		stateMachineArn,
		input: JSON.stringify({inputNumber: '1'})
	};
	return new Promise((resolve, reject) => {
		let countSuccess = 0;

		const onSuccess = function (out) {
			countSuccess++;
			if (out.workerName === worker.workerName) {
				t.fail('workerName should be same than in worker');
			}

			if (countSuccess === 1) {
				const beforeRestartLength = worker._poolers.length;
				console.log('restart');
				worker.restart(() => {
					console.log('restarted');
					t.is(worker._poolers.length, beforeRestartLength);
					stepFunction.startExecution(params2).promise();
				});
			}

			if (countSuccess === 2) {
				resolve();
			}
		};

		worker.on('success', onSuccess);
		worker.on('error', reject);
		stepFunction.startExecution(params1).promise();
	});
});

test.after(after);

