const AWS = require('aws-sdk');
const winston = require('winston');

const logger = winston.createLogger({
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

async function getStateMachineArns(reg) {
	let nextToken;
	let stateMachineArns = [];
	do {
		const data = await stepfunctions.listStateMachines({...nextToken && {nextToken}}).promise();

		nextToken = data.nextToken;

		stateMachineArns = [
			...stateMachineArns,
			...data.stateMachines
				.map(stm => stm.stateMachineArn)
				.filter(stmArn => reg.test(stmArn))
		];
	} while (nextToken);

	return stateMachineArns;
}

const removeStateMachines = async function (reg) {
	const stateMachineArns = await getStateMachineArns(reg);

	for (const stateMachineArn of stateMachineArns) {
		const {definition: rawDefinition} = await stepfunctions.describeStateMachine({stateMachineArn}).promise();
		const definition = JSON.parse(rawDefinition);
		const activityArn = definition.States.FirstState.Resource;

		await stepfunctions.deleteActivity({activityArn}).promise();
		logger.info(`Activity ${activityArn} was deleted`);

		await stepfunctions.deleteStateMachine({stateMachineArn}).promise();
		logger.info(`StateMachine ${stateMachineArn} was deleted`);
	}
};

removeStateMachines(reg).catch(error => {
	logger.error(error);
});
