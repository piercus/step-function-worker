const AWS = require('aws-sdk');
const winston = require('winston');

const logger = new winston.Logger({
	transports: [new winston.transports.Console({
		level: 'info'
	})]
});

if (typeof (process.env.AWS_REGION) !== 'string') {
	throw (new TypeError('$AWS_REGION must be defined'));
}

const stepfunctions = new AWS.StepFunctions({
	region: process.env.AWS_REGION
});

const reg = /stateMachine:test-state-machine/;

const removeStateMachines = async function (reg) {
	const {stateMachines} = await stepfunctions.listStateMachines({}).promise();
	const stateMachineArns = stateMachines
		.map(stm => stm.stateMachineArn)
		.filter(stmArn => reg.test(stmArn));

	for (const stateMachineArn of stateMachineArns) {
		const {definition: rawDefinition} = await stepfunctions.describeStateMachine({stateMachineArn}).promise();
		const definition = JSON.parse(rawDefinition);
		const activityArn = definition.States.FirstState.Resource;

		await stepfunctions.deleteActivity({activityArn}).promise();
		logger.info('Activity ', activityArn, ' was deleted');

		await stepfunctions.deleteStateMachine({stateMachineArn}).promise();
		logger.info('StateMachine ', stateMachineArn, ' was deleted');
	}
};

removeStateMachines(reg).catch(error => {
	logger.error(error);
});
