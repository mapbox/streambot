#!/usr/bin/env node

var exec = require('child_process').exec;
var fs = require('fs');
var AWS = require('aws-sdk');

module.exports.deploy = deploy;
module.exports.bundle = bundle;
module.exports.getStackOutputs = getStackOutputs;
module.exports.gitsha = gitsha;
module.exports.uploadFunction = uploadFunction;
module.exports.setEventSource = setEventSource;

function deploy(stackName, region, fnName, description, callback) {
  bundle(stackName, region, function(err, zipfile) {
    if (err) return callback(err, zipfile);

    getStackOutputs(stackName, region, function(err, outputs) {
      if (err) return callback(err);

      gitsha(function(err, sha) {
        if (err) return callback(err);

        uploadFunction(region, fnName, zipfile, sha, outputs.LambdaExecutionRole, description, function(err, arn) {
          if (err) return callback(err);

          setEventSource(function(err) {
            if (err) return callback(err);

            callback(null, arn);
          });
        });
      });
    });
  });
}

function bundle(stackName, region, callback) {
  exec(['npm run bundle', stackName, region].join(' '), function(err, stdout, stderr) {
    if (err) return callback(err, stderr);
    callback(null, stdout);
  });
}

function getStackOutputs(stackName, region, callback) {
  var cfn = new AWS.CloudFormation({ region: region });

  cfn.describeStacks({ StackName: stackName }, function(err, data) {
    if (err) return callback(err);
    if (!data.Stacks.length) return callback(new Error('Could not find stack ' + stackName));

    var streambotStack = data.Stacks[0].Outputs.filter(function(output) {
      return output.OutputKey === 'StreambotStack';
    })[0];

    if (!streambotStack) return callback(new Error('Stack missing StreambotStack output'));

    cfn.describeStacks({ StackName: streambotStack }, function(err, data) {
      if (err) return callback(err);
      if (!data.Stacks.length) return callback(new Error('Could not find stack ' + stackName));

      var outputs = data.Stacks[0].Outputs.reduce(function(outputs, output) {
        outputs[output.OutputKey] = output.OutputValue;
        return outputs;
      }, {});

      callback(null, outputs);
    });
  });
}

function gitsha(callback) {
    exec('git rev-parse HEAD', function (err, gitsha) {
        if (err) return callback(err);
        callback(null, gitsha.trim());
    });
}

function uploadFunction(region, fnName, zipfile, gitsha, executionRole, description, callback) {
  var lambda = new AWS.Lambda({ region: region });

  lambda.uploadFunction({
    FunctionName: fnName,
    FunctionZip: fs.createReadStream(zipfile),
    Handler: 'build/' + gitsha + '.streambot',
    Mode: 'event',
    Role: executionRole,
    Runtime: 'nodejs',
    Description: description,
    MemorySize: 128,
    Timeout: 60
  }, function(err, data) {
    if (err) return callback(err);
    callback(null, data.FunctionARN);
  });
}

function setEventSource(region, streamArn, fnName, invocationRole, callback) {
  var lambda = new AWS.Lambda({ region: region });

  lambda.listEventSources({
    EventSourceArn: streamArn,
    FunctionName: fnName
  }, function(err, data) {
    if (err) return callback(err);
    if (data.EventSources.length) return callback(null, data.EventSources[0].UUID);

    lambda.setEventSource({
      EventSource: streamArn,
      FunctionName: fnName,
      Role: invocationRole,
      BatchSize: 100,
      Parameters: {
        InitialPositionInStream: 'TRIM_HORIZON'
      }
    }, function(err, data) {
      if (err) return callback(err);
      callback(null, data.UUID);
    });
  });
}

if (require.main === module) {
  var fnName = process.env.npm_package_name + '-' + process.argv[2];
  var stackName = process.argv[3];
  var region = process.argv[4] || 'us-east-1';
  var description = process.env.npm_package_description;

  deploy(stackName, region, fnName, description, function(err, log) {
    if (err && log) console.error(log);
    if (err) throw err;
  });
}
