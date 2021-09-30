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

module.exports = async function ({context = {}, activityName, workerName, stateMachineName}) {
	const {activityArn} = await stepFunction.createActivity({name: activityName}).promise();
	const {stateMachineArn} = stepFunction.createStateMachine({
		definition: JSON.stringify(stateMachineDefinition({activityArn})), /* Required */
		name: stateMachineName, /* Required */
		roleArn: stateMachineRoleArn /* Required */
	}).promise();
	context.activityArn = activityArn;
	context.workerName = workerName;
	context.stateMachineArn = stateMachineArn;
	return context;
};
