const AWS = require('aws-sdk');

const stepFunction = new AWS.StepFunctions();

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

module.exports = function ({context = {}, activityName, workerName, stateMachineName}) {
	return stepFunction
		.createActivity({
			name: activityName
		}).promise().then(data => {
			context.activityArn = data.activityArn;
			context.workerName = workerName;
		}).then(() => {
			const params = {
				definition: JSON.stringify(stateMachineDefinition({activityArn: context.activityArn})), /* Required */
				name: stateMachineName, /* Required */
				roleArn: stateMachineRoleArn /* Required */
			};
			return stepFunction.createStateMachine(params).promise();
		}).then(data => {
			context.stateMachineArn = data.stateMachineArn;
		}).then(() => {
			return context;
		});
};
