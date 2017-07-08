[![Build Status](https://travis-ci.org/piercus/step-function-worker.svg?branch=master)](https://travis-ci.org/piercus/step-function-worker)
# step-function-worker
Create a nodejs aws step-function worker/pooler easily :-)

## install

```
npm install step-function-worker
```

### Example usage

#### Basic example

```
var fn = function(input, cb, heartbeat){
  // do something
  doSomething(input)

  // call heartbeat sometime to avoid timeout
  heartbeat()

  // call callback in the end
  cb(null, {"foo" : "bar"}); // output must be compatible with JSON.stringify
};

var worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  concurrency : 2 // default is 1
});
```

#### Close the worker

```
// when finish close the worker with a callback
// this closing process may take up to 60 seconds per concurent worker, to close all connections smoothly without loosing any task
worker.close(function(){
  process.exit();
})
```

#### Events


```
worker.on('task', function(task){
  // task.taskToken
  // task.input
  console.log("task ", task.input)
});

worker.on('failure', function(failure){
  // out.error
  // out.taskToken
  console.log("Failure :",failure.error)
});

worker.on('heartbeat', function(beat){
  // out.taskToken
  console.log("Heartbeat");
});

worker.on('success', function(out){
  // out.output
  // out.taskToken
  console.log("Success :",out.output)
});

worker.on('error', function(err){
  console.log("error ", err)
});
```

### TO DO

When closing a worker, i feel we cannot abort safely
