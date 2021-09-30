const AWS = require('aws-sdk');

const stepfunction = new AWS.StepFunctions();

const activityArn = 'arn:aws:states:eu-central-1:170670752151:activity:test-step-function-worker-94';
const stateMachineArn = 'arn:aws:states:eu-central-1:170670752151:stateMachine:test-state-machine-253';
const parametersStartExecution = {
	stateMachineArn /* Required */
};
const parametersFirstGetActivity = {
	activityArn, /* Required */
	workerName: 'worker1'
};
const parametersSecondGetActivity = {
	activityArn, /* Required */
	workerName: 'worker2'
};
const onFirstActivityTask = function (error, data) {
	console.log('in first activity task', error, data); // An error occurred
	stepfunction.getActivityTask(parametersSecondGetActivity, (error, data) => {
		console.log('in second activity task', error, data); // An error occurred
	});
	stepfunction.startExecution(parametersStartExecution, (error, data) => {
		console.log('in start execution', error, data); // An error occurred
	});
};

const firstGetActivityTaskRequest = stepfunction.getActivityTask(parametersFirstGetActivity, onFirstActivityTask);
setTimeout(() => {
	firstGetActivityTaskRequest.abort();
}, 2000);
