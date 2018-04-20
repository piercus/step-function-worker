const PromiseBlue = require('bluebird');
const AWS = require('aws-sdk');

const stepfunction = new AWS.StepFunctions();
const stepFunctionPromises = PromiseBlue.promisifyAll(stepfunction);

module.exports = function ({
	activityArn = null,
	stateMachineArn = null
}) {
	let p1;
	let p2;
	if (activityArn) {
		p1 = stepFunctionPromises.deleteActivityAsync({
			activityArn
		});
	} else {
		p1 = Promise.resolve();
	}
	if (stateMachineArn) {
		p2 = stepFunctionPromises.deleteStateMachineAsync({
			stateMachineArn
		});
	} else {
		p2 = Promise.resolve();
	}
	return Promise.all([p1, p2]);
};
