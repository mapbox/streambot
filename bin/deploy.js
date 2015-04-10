#!/usr/bin/env node

var queue = require('queue-async');
var _ = require('underscore');
var fastlog = require('fastlog')('streambot-deploy', 'info');
var lib = require('../lib/deploy');

module.exports.deploy = deploy;

var getStackOutputs = lib.getStackOutputs;
var getStackParameters = lib.getStackParameters;
var getStackResources = lib.getStackResources;
var wrap = lib.wrap;
var bundle = lib.bundle;
var uploadFunction = lib.uploadFunction;
var setEventSource = lib.setEventSource;

function deploy(service, script, environment, region, description, callback) {
  var stackName = [service, environment].join('-');
  var outputs;
  var parameters;
  var resources;
  var zipfile;

  queue(1)
    .defer(function(next) {
      fastlog.info('Starting deploy of %s', stackName);
      getStackOutputs(stackName, region, function(err, out) {
        outputs = out;
        next(err);
      });
    })
    .defer(function(next) {
      fastlog.info('Found stack outputs');
      _(outputs).each(function(val, k) {
        fastlog.debug('%s = %s', k, val);
      });

      getStackParameters(stackName, region, function(err, params) {
        parameters = params;
        next(err);
      });
    })
    .defer(function(next) {
      fastlog.info('Found stack parameters');
      _(parameters).each(function(val, k) {
        fastlog.debug('%s = %s', k, val);
      });

      getStackResources(stackName, region, function(err, res) {
        resources = res;
        next(err);
      });
    })
    .defer(function(next) {
      fastlog.info('Found stack resources');
      _(resources).each(function(val, k) {
        fastlog.debug('%s = %s', k, val);
      });

      wrap(_.extend({ StackName: stackName }, parameters, resources, outputs), next);
    })
    .defer(function(next) {
      fastlog.info('Setup environment');
      bundle(function(err, zip) {
        zipfile = zip;
        next(err);
      });
    })
    .defer(function(next) {
      fastlog.info('Bundled %s', zipfile);
      uploadFunction(region, stackName, zipfile, script, outputs.LambdaExecutionRole, description, next);
    })
    .defer(function(next) {
      fastlog.info('Uploaded function');
      setEventSource(region, outputs.KinesisStream, stackName, outputs.LambdaInvocationRole, next);
    })
    .await(function(err) {
      if (err) return callback(err);
      fastlog.info('Set function event source and completed deploy');
      callback();
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
