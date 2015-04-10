var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var AWS = require('aws-sdk');
var queue = require('queue-async');
var _ = require('underscore');

module.exports.getStackOutputs = getStackOutputs;
module.exports.getStackParameters = getStackParameters;
module.exports.getStackResources = getStackResources;
module.exports.wrap = wrap;
module.exports.bundle = bundle;
module.exports.uploadFunction = uploadFunction;
module.exports.setEventSource = setEventSource;

function getStackOutputs(stackName, region, callback) {
  var cfn = new AWS.CloudFormation({ region: region });

  var outputs = {};

  function outputToObject(outObject, output) {
    outObject[output.OutputKey] = output.OutputValue;
    return outObject;
  }

  cfn.describeStacks({ StackName: stackName }, function(err, data) {
    if (err) return callback(err);
    if (!data.Stacks.length) return callback(new Error('Could not find stack ' + stackName));

    var streambotStack = data.Stacks[0].Outputs.filter(function(output) {
      return output.OutputKey === 'StreambotStack';
    })[0];

    if (!streambotStack) return callback(new Error('Stack missing StreambotStack output'));

    outputs = data.Stacks[0].Outputs.reduce(outputToObject, outputs);

    cfn.describeStacks({ StackName: streambotStack.OutputValue }, function(err, data) {
      if (err) return callback(err);
      if (!data.Stacks.length) return callback(new Error('Could not find stack ' + stackName));

      outputs = data.Stacks[0].Outputs.reduce(outputToObject, outputs);

      callback(null, outputs);
    });
  });
}

function getStackParameters(stackName, region, callback) {
  var cfn = new AWS.CloudFormation({ region: region });

  cfn.describeStacks({ StackName: stackName }, function(err, data) {
    if (err) return callback(err);
    if (!data.Stacks.length) return callback(new Error('Could not find stack ' + stackName));

    var parameters = data.Stacks[0].Parameters.reduce(function(parameters, param) {
      parameters[param.ParameterKey] = param.ParameterValue;
      return parameters;
    }, {});

    callback(null, parameters);
  });
}

function getStackResources(stackName, region, callback) {
  var cfn = new AWS.CloudFormation({ region: region });

  cfn.describeStackResources({ StackName: stackName }, function(err, data) {
    if (err) return callback(err);

    var resources = data.StackResources.reduce(function(resources, resource) {
      resources[resource.LogicalResourceId] = resource.PhysicalResourceId;
      return resources;
    }, {});

    callback(null, resources);
  });
}

function wrap(env, callback) {
  var dotenv = _(env).reduce(function(dotenv, val, key) {
    dotenv += [key, val].join('=') + '\n';
    return dotenv;
  }, '');

  fs.writeFile(path.resolve('.env'), dotenv, callback);
}

function bundle(callback) {
  exec(['$(npm bin)/streambot-bundle', process.cwd()].join(' '), function(err, stdout, stderr) {
    if (err) return callback(err, stderr);
    callback(null, stdout.trim());
  });
}

function uploadFunction(region, fnName, zipfile, script, executionRole, description, callback) {
  var lambda = new AWS.Lambda({ region: region });

  var handler = path.dirname(script) === '.' ? '' : path.dirname(script) + '/';
  handler += path.basename(script, path.extname(script)) + '.streambot';

  var params = {
    FunctionName: fnName,
    FunctionZip: fs.readFileSync(zipfile),
    Handler: handler,
    Mode: 'event',
    Role: executionRole,
    Runtime: 'nodejs',
    Description: description,
    MemorySize: 128,
    Timeout: 60
  };

  lambda.uploadFunction(params, function(err, data) {
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

    var params = {
      EventSource: streamArn,
      FunctionName: fnName,
      Role: invocationRole,
      BatchSize: 100,
      Parameters: {
        InitialPositionInStream: 'TRIM_HORIZON'
      }
    };

    lambda.addEventSource(params, function(err, data) {
      if (err) return callback(err);
      callback(null, data.UUID);
    });
  });
}
