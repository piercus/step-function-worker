[![Build Status](https://travis-ci.org/piercus/step-function-worker.svg?branch=master)](https://travis-ci.org/piercus/step-function-worker)

[![codecov](https://codecov.io/gh/piercus/step-function-worker/branch/master/graph/badge.svg)](https://codecov.io/gh/piercus/step-function-worker)

# step-function-worker

Create a nodejs aws step-function worker/pooler easily :-)

## install

```
npm install step-function-worker
```

### Example usage

#### Basic example

```javascript
const fn = function(input, cb, heartbeat){
  // do something
  doSomething(input)

  // call heartbeat to avoid timeout
  heartbeat()

  // call callback in the end
  cb(null, {"foo" : "bar"}); // output must be compatible with JSON.stringify
};

const worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  taskConcurrency : 22, // default is null = Infinity
  poolConcurrency : 2 // default is 1
});
```

### Concurrency management

Since version **3.0**, `concurrency` has been replaced by `poolConcurrency` and `taskConcurrency`.

* `taskConcurrency` (`null` means Infinite)

It represent the maximum number of parallel tasks done by the worker (default: `null`).

* `poolConcurrency` is the maximum number of parallel getActivity, http request (see [`sdk.getActivity`](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/StepFunctions.html#getActivityTask-property)) (default: `1`)

Increase this to have a more responsive worker.

Anyway, you should always have `poolConcurrency` < `taskConcurrency`.

#### Set the Region

By default, this package is built on top of `aws-sdk` so you should set your AWS Region by changing `AWS_REGION` environment variable.

If you want to set it in JS code directly you can do it using `awsConfig` (see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html to see all available options) like 

```javascript
const worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  awsConfig: {
    region: '<your-region>'
  }
});
```

#### Close the worker

```javascript
// when finish close the worker with a callback
// this closing process may take up to 60 seconds per concurent worker, to close all connections smoothly without loosing any task
worker.close(function(){
  process.exit();
})
```

#### Get info on current worker

```javascript
// A worker as multiple poolers and multiple running tasks
// You can have infos about it by doing
const {poolers, tasks} = worker.report();

// poolers is an array of {
//   startTime: <Date>,
//   workerName: <String>,
//   status: <String>
// }
//
// tasks is an array of {
//  taskToken: <String>,
//  input: <Object>,
//  startTime: <Date>
// }
//
```

#### Custom logging with winston

You can customize logging by using a [winston](https://www.npmjs.com/package/winston) logger (or winston-like logger) as input

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  defaultMeta: { service: 'user-service' },
  transports: [
    //
    // - Write to all logs with level `info` and below to `combined.log` 
    // - Write all logs error (and below) to `error.log`.
    //
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  logger
});
```

Alternatively, you can just use a winston-like logger

```javascript
const logger = console;

const worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  logger
});
```

#### Events


```javascript
// when a task starts
worker.on('task', function(task){
  // task.taskToken
  // task.input
  console.log("task ", task.input)
});

// when a task fails
worker.on('failure', function(failure){
  // out.error
  // out.taskToken
  console.log("Failure :",failure.error)
});

// when a heartbeat signal is sent
worker.on('heartbeat', function(beat){
  // out.taskToken
  console.log("Heartbeat");
});

// when a task succeed
worker.on('success', function(out){
  // out.output
  // out.taskToken
  console.log("Success :",out.output)
});

// when an error happens
worker.on('error', function(err){
  console.log("error ", err)
});

// when the worker has no more task to process
worker.on('empty', function(){
  console.log("error ", err)
});

// when the worker reaches taskConcurrency tasks
worker.on('full', function(err){
  console.log("error ", err)
});
```

### Documentation

See JSDoc in the code.

