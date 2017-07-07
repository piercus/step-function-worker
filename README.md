# step-function-worker
Create a nodejs aws step-function worker/pooler easily :-)

## install

```
npm install step-function-worker
```

### Example usage

```
var fn = function(input, cb, heartbeat){
  // do something
  cb(null, {"foo" : "bar"}); // output must be compatible with JSON.stringify
};

var worker = new StepFunctionWorker({
  activityArn : '<activity-ARN>',
  workerName : 'workerName',
  fn : fn,
  concurrency : 2 // default is 1
});

```

### Events


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
