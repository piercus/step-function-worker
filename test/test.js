const assert = require('assert');
const vows = require('vows');
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

const before = function () {
	const context = this;

	return stepFunctionPromises.createActivityAsync({
		name: activityName
	}).bind(context).then(function (data) {
		this.activityArn = data.activityArn;
		this.workerName = workerName;
	}).then(function () {
		const params = {
			definition: JSON.stringify(stateMachineDefinition({activityArn: this.activityArn})), /* Required */
			name: stateMachineName, /* Required */
			roleArn: stateMachineRoleArn /* Required */
		};

		return stepFunctionPromises.createStateMachineAsync(params);
	}).then(function (data) {
		this.stateMachineArn = data.stateMachineArn;
	}).then(() => {

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
// Create a Test Suite
const buildSuite = function (options) {
	const activityArn = options.activityArn;
	const stateMachineArn = options.stateMachineArn;
	const workerName = options.workerName;
	let workerGl;

	const suite = vows.describe('Step function Activity Worker').addBatch({
		'Step function with callback worker': {
			topic() {
				const worker = new StepFunctionWorker({
					activityArn,
					workerName: workerName + '-fn',
					fn
				});

				workerGl = worker;

				worker.on('task', task => {
          // Task.taskToken
          // task.input
					console.log('Task ', task.input);
				});
				worker.on('failure', failure => {
          // Out.error
          // out.taskToken
					console.log('Failure :', failure.error);
				});

				worker.on('Heartbeat', () => {
          // Out.taskToken
					console.log('Heartbeat');
				});

				worker.on('Success', out => {
          // Out.output
          // out.taskToken
					console.log('Success :', out.output);
				});

				worker.on('error', err => {
					console.log('error ', err);
				});

				return worker;
			},

			'task event': {
				topic(worker) {
					const self = this;
					const params = {
						stateMachineArn,
						input: JSON.stringify(sentInput)
					};

					worker.once('task', task => {
            // Task.taskToken
            // task.input
						self.callback(null, {task, worker, taskTokenInput: task.taskToken});
					});

					stepFunctionPromises.startExecutionAsync(params);
				},

				'data contains input and taskToken'(res) {
					const task = res.task;
					assert.deepEqual(task.input, sentInput);
					assert.equal(typeof (task.taskToken), 'string');
				},
				'success event': {
					topic(res) {
						res.worker.once('success', out => {
							this.callback(null, {worker: res.worker, out, taskTokenInput: res.taskTokenInput});
						});
					},
					'taskToken corresponds'(res) {
						assert.equal(res.out.taskToken, res.taskTokenInput);
					},
					'2nd task': {
						topic(res) {
							const worker = res.worker;

							const params = {
								stateMachineArn,
								input: JSON.stringify(sentInput)
							};

							let taskTokenInput;

							worker.once('task', task => {
                // Task.taskToken
                // task.input
								taskTokenInput = task.taskToken;
							});

							worker.once('success', out => {
								this.callback(null, {out, taskTokenInput, worker});
							});

							stepFunctionPromises.startExecutionAsync(params);
						},

						'taskToken corresponds'(res) {
							assert.equal(res.out.taskToken, res.taskTokenInput);
						},
						'close the worker': {
							topic(res) {
								res.worker.close(() => {
									this.callback(null, res.worker);
								});
							},
							'close the worker'(worker) {
								assert.equal(worker._poolers.length, 0);
							}
						}
					}

				}
			}
		}
	}).addBatch({
		'Step function with 3 concurrent worker': {
			topic() {
				const worker = new StepFunctionWorker({
					activityArn,
					workerName: workerName + '-concurrent',
					fn: fn2,
					concurrency: 3
				});
				workerGl = worker;

				worker.on('task', task => {
          // Task.taskToken
          // task.input
					console.log('task ', task.input);
				});
				worker.on('failure', failure => {
          // Out.error
          // out.taskToken
					console.log('Failure :', failure.error);
				});

				worker.on('heartbeat', () => {
          // Out.taskToken
					console.log('Heartbeat');
				});

				worker.on('success', out => {
          // Out.output
          // out.taskToken
					console.log('Success :', out.output);
				});

				worker.on('error', err => {
					console.log('error ', err);
				});

				return worker;
			},

			'task event': {
				topic(worker) {
					const self = this;
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
					let count = 0;
					const workerNames = [];
					const startDate = new Date();

					const onTask = function (task) {
            // Task.taskToken
            // task.input
            // task.workerName
						count++;

						if (workerNames.indexOf(task.workerName) === -1) {
							workerNames.push(task.workerName);
						}
						if (count === 3) {
							worker.removeListener('task', onTask);
							self.callback(null, {task, worker, taskTokenInput: task.taskToken, workerNames, startDate});
						}
					};

					worker.on('task', onTask);

					stepFunctionPromises.startExecutionAsync(params1);
					stepFunctionPromises.startExecutionAsync(params2);
					stepFunctionPromises.startExecutionAsync(params3);
				},
				'all workzers have worked corresponds'(res) {
					assert.equal(res.workerNames.length, 3);
				},
				'success event': {
					topic(res) {
						const worker = res.worker;
						let count = 0;
						const workerNames = [];

						const onSuccess = function (out) {
							count++;
							if (workerNames.indexOf(out.workerName) === -1) {
								workerNames.push(out.workerName);
							}
							if (count === 3) {
								worker.removeListener('success', onSuccess);
								const endDate = new Date();
								this.callback(null, {worker, workerNames, startDate: res.startDate, endDate});
							}
						}.bind(this);

						res.worker.on('success', onSuccess);
					},
					'tasks are done in parallel startDate- endDate comparison'(res) {
						assert.equal(res.workerNames.length, 3);
						assert((res.endDate - res.startDate) / 1000 < 3);
						assert((res.endDate - res.startDate) / 1000 > 2);
					},
					'close the worker': {
						topic(res) {
							res.worker.close(() => {
								this.callback(null, res.worker);
							});
						},
						'close the worker'(worker) {
							assert.equal(worker._poolers.length, 0);
						}
					}
				}
			}
		}
	});

	suite.close = function () {
		if (workerGl) {
			return PromiseBlue.promisify(workerGl.close, {context: workerGl})();
		}
		return PromiseBlue.resolve();
	};
	return suite;
};

PromiseBlue.resolve()
  .bind({})
  .then(before)
  .then(function () {
	const suite = buildSuite(this);
	return PromiseBlue.promisify(suite.run, {context: suite})().timeout(200000).catch(err => {
		return suite.close().then(() => {
			return PromiseBlue.reject(err);
		});
	});
})
  .finally(after);
