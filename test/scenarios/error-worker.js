const test = require('ava');

process.on('uncaughtException', err => {
	console.log('uncaughtException', err);
});

const workerName = 'test worker name';
const StepFunctionWorker = require('../..');

test.serial('Step function Activity Worker worker without fn', t => {
	const error = t.throws(() => {
		const test = new StepFunctionWorker({ // eslint-disable-line no-unused-vars
			activityArn: 'fake-actovuty-arn',
			workerName: workerName + '-fn'
		});
	});
	t.is(error.message, 'worker does not define any function');
});

