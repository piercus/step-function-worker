const test = require('ava').test;
const AWS = require('aws-sdk');
const PromiseBlue = require('bluebird');
const winston = require('winston');

const StepFunctionWorker = require('../../index.js');
const createActivity = require('../utils/create-activity');
const cleanUp = require('../utils/clean-up');

const stepfunction = new AWS.StepFunctions();
const stepFunctionPromises = PromiseBlue.promisifyAll(stepfunction);

const logger = new winston.Logger({
	transports: [new winston.transports.Console({
		level: 'debug'
	})]
});

const workerName = 'test worker name';
const stateMachineName = 'test-state-machine-' + Math.floor(Math.random() * 1000);
const activityName = 'test-step-function-worker-' + Math.floor(Math.random() * 1000);

process.on('uncaughtException', err => {
	console.log('uncaughtException', err);
});
/*
{
	definition: '{"Comment":"An Example State machine using Activity.","StartAt":"FirstState","States":{"FirstState":{"Type":"Task","Resource":"arn:aws:states:eu-central-1:170670752151:activity:test-step-function-worker","TimeoutSeconds":300,"HeartbeatSeconds":60,"Next":"End"}}}',
	name: 'test-state-machine',
	roleArn: 'arn:aws:iam::170670752151:role/service-role/StatesExecutionRole-eu-central-1'
}
*/

const context = {};

const before = createActivity.bind(null, {context, activityName, stateMachineName, workerName});
const after = cleanUp.bind(null, {context, activityName, stateMachineName, workerName});

const sentInput = {foo: 'bar'};

const fn = function (event, callback, heartbeat) {
	heartbeat();
	setTimeout(() => {
		const err = new Error('custom error');
		// Assert.equal(event, sentInput);
		callback(null, event);
	}, 2000);
};

test.before(before);

test.serial('Step function Activity Workerhas a ready event', t => {
	const activityArn = context.activityArn;
	const stateMachineArn = context.stateMachineArn;

	return new Promise((resolve, reject) => {
		const worker = new StepFunctionWorker({
			activityArn,
			workerName: workerName + '-fn',
			fn: fn,
			logger
		});
		let ready = false;
		worker.on('ready', () => {
			t.pass();
			ready = true;
			resolve();
		});
		
		setTimeout(function(){
			if(!ready){
				t.fail();
				reject();
			}
		},1000)

	});
});

test.after(after);

