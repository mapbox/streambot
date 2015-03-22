#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var AWS = require('aws-sdk');

module.exports = wrap;

function wrap(service, region, stackName, callback) {
  var cfn = new AWS.CloudFormation({ region: region });
  var streambot = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'));

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

      var metric = data.Stacks[0].Parameters.filter(function(param) {
        return param.ParameterKey === 'MetricName';
      }, {})[0];

      if (!metric) return callback(new Error('Stack missing MetricName parameter'));
      metric = metric.ParameterValue;

      callback(null, streambot.replace('${service}', service).replace('${metric}', metric));
    });
  });
}

if (require.main === module) {
  var service = process.argv[2];
  var stackName = process.argv[3];
  var region = process.argv[4] || 'us-east-1';

  wrap(service, region, stackName, function(err, script) {
    if (err) throw err;
    process.stdout.write(script);
  });
}
