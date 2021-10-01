const AWS = require('aws-sdk');

const stepFunction = new AWS.StepFunctions();

module.exports = async function ({
	activityArn = null,
	stateMachineArn = null
}) {
	if (activityArn) {
		await stepFunction.deleteActivity({
			activityArn
		}).promise();
	}

	if (stateMachineArn) {
		await stepFunction.deleteStateMachine({
			stateMachineArn
		}).promise();
	}
};
