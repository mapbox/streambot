#!/usr/bin/env node

var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var AWS = require('aws-sdk');
var queue = require('queue-async');
var _ = require('underscore');

module.exports.deploy = deploy;
module.exports.getStackOutputs = getStackOutputs;
module.exports.getStackParameters = getStackParameters;
module.exports.getStackResources = getStackResources;
module.exports.wrap = wrap;
module.exports.bundle = bundle;
module.exports.uploadFunction = uploadFunction;
module.exports.setEventSource = setEventSource;

function deploy(service, script, environment, region, description, callback) {
  var stackName = [service, environment].join('-');
  var outputs;
  var parameters;
  var resources;
  var zipfile;

  queue(1)
    .defer(function(next) {
      getStackOutputs(stackName, region, function(err, out) {
        outputs = out;
        next(err);
      });
    })
    .defer(function(next) {
      getStackParameters(stackName, region, function(err, params) {
        parameters = params;
        next(err);
      });
    })
    .defer(function(next) {
      getStackResources(stackName, region, function(err, res) {
        resources = res;
        next(err);
      });
    })
    .defer(function(next) {
      wrap(_.extend({}, parameters, resources, outputs), next);
    })
    .defer(function(next) {
      bundle(function(err, zip) {
        zipfile = zip;
        next(err);
      });
    })
    .defer(function(next) {
      uploadFunction(region, stackName, zipfile, script, outputs.LambdaExecutionRole, description, next);
    })
    .defer(function(next) {
      setEventSource(region, outputs.KinesisStream, stackName, outputs.LambdaInvocationRole, next);
    })
    .await(callback);
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

    cfn.describeStacks({ StackName: streambotStack.OutputValue }, function(err, data) {
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

    lambda.addEventSource({
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
  var args = require('minimist')(process.argv.slice(2));
  var service = process.env.npm_package_name;
  var script = process.env.npm_package_main;
  var environment = args._[0];
  var region = args.region || 'us-east-1';
  var description = process.env.npm_package_description;

  deploy(service, script, environment, region, description, function(err) {
    if (err) throw err;
  });
}
