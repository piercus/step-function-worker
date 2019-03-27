const AWS = require('aws-sdk');

const stepFunction = new AWS.StepFunctions();

module.exports = function ({
	activityArn = null,
	stateMachineArn = null
}) {
	let p1;
	let p2;
	if (activityArn) {
		p1 = stepFunction.deleteActivity({
			activityArn
		}).promise();
	} else {
		p1 = Promise.resolve();
	}

	if (stateMachineArn) {
		p2 = stepFunction.deleteStateMachine({
			stateMachineArn
		}).promise();
	} else {
		p2 = Promise.resolve();
	}

	return Promise.all([p1, p2]);
};
