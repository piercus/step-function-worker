const AWS = require('aws-sdk');
const PromiseBlue = require('bluebird');
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

const reg = new RegExp('stateMachine:test-state-machine');

const removeStateMachines = function (reg) {
	const params = {};
	return stepfunctions.listStateMachines(params).promise().then(data => {
		const stateMachinesArn = [];
		data.stateMachines.forEach(stm => {
			if (reg.test(stm.stateMachineArn)) {
				stateMachinesArn.push(stm.stateMachineArn);
			}
		});
		return stateMachinesArn;
	}).then(stateMachinesArn => {
		return PromiseBlue.map(stateMachinesArn, stateMachineArn => {
			const params = {
				stateMachineArn
			};
			return stepfunctions.describeStateMachine(params).promise().then(data => {
				const definition = JSON.parse(data.definition);
				const activityArn = definition.States.FirstState.Resource;
				const params = {
					activityArn
				};
				return stepfunctions.deleteActivity(params).promise().then(() => {
					logger.info('Activity ', params.activityArn, ' was deleted');
				});
			}).then(() => {
				return stepfunctions.deleteStateMachine(params).promise().then(() => {
					logger.info('StateMachine ', params.stateMachineArn, ' was deleted');
				});
			});
		}, {concurrency: 1});
	});
};

removeStateMachines(reg).catch(err => {
	logger.error(err);
});
