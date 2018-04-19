const test = require('ava').test;
const AWS = require('aws-sdk');
const PromiseBlue = require('bluebird');
const StepFunctionWorker = require('../index.js');

const stepfunction = new AWS.StepFunctions();
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
const stateMachineDefinition = function (options) {
	return {
		Comment: 'An Example State machine using Activity.',
		StartAt: 'FirstState',
		States: {
			FirstState: {
				Type: 'Task',
				Resource: options.activityArn,
				TimeoutSeconds: 300,
				HeartbeatSeconds: 60,
				End: true
			}
		}
	};
};

const stateMachineRoleArn = process.env.ROLE_ARN;
if (!stateMachineRoleArn) {
	throw (new Error('$ROLE_ARN should be defined to run this test'));
}

const stepFunctionPromises = PromiseBlue.promisifyAll(stepfunction);

let context;

const before = function () {
	context = {};

	return stepFunctionPromises.createActivityAsync({
		name: activityName
	}).bind(context).then(data => {
		context.activityArn = data.activityArn;
		context.workerName = workerName;
	}).then(function () {
		const params = {
			definition: JSON.stringify(stateMachineDefinition({activityArn: this.activityArn})), /* Required */
			name: stateMachineName, /* Required */
			roleArn: stateMachineRoleArn /* Required */
		};

		return stepFunctionPromises.createStateMachineAsync(params);
	}).then(data => {
		context.stateMachineArn = data.stateMachineArn;
	}).return(context);
};

const after = function () {
	let p1;
	let p2;
	if (this.activityArn) {
		p1 = stepFunctionPromises.deleteActivityAsync({
			activityArn: this.activityArn
		});
	} else {
		p1 = PromiseBlue.resolve();
	}
	if (this.stateMachineArn) {
		p2 = stepFunctionPromises.deleteStateMachineAsync({
			stateMachineArn: this.stateMachineArn
		});
	} else {
		p2 = PromiseBlue.resolve();
	}
	return PromiseBlue.all([p1, p2]);
};

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

test('Step function Activity Worker with 2 consecutive tasks', t => {
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

test('Step function with 3 concurrent worker', t => {
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

