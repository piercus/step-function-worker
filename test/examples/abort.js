const AWS = require('aws-sdk');

const stepfunction = new AWS.StepFunctions();

const activityArn = 'arn:aws:states:eu-central-1:170670752151:activity:test-step-function-worker-94';
const stateMachineArn = 'arn:aws:states:eu-central-1:170670752151:stateMachine:test-state-machine-253';
const paramsStartExecution = {
	stateMachineArn /* Required */
};
const paramsFirstGetActivity = {
	activityArn, /* Required */
	workerName: 'worker1'
};
const paramsSecondGetActivity = {
	activityArn, /* Required */
	workerName: 'worker2'
};
const onFirstActivityTask = function (err, data) {
	console.log('in first activity task', err, data); // An error occurred
	stepfunction.getActivityTask(paramsSecondGetActivity, (err, data) => {
		console.log('in second activity task', err, data); // An error occurred
	});
	stepfunction.startExecution(paramsStartExecution, (err, data) => {
		console.log('in start execution', err, data); // An error occurred
	});
};
const firstGetActivityTaskRequest = stepfunction.getActivityTask(paramsFirstGetActivity, onFirstActivityTask);
setTimeout(() => {
	firstGetActivityTaskRequest.abort();
}, 2000);
