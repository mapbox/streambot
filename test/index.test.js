var test = require('tape');
var streambot = require('..');
var e = require('./fixtures/event');
var path = require('path');
var fs = require('fs');
var AWS = require('aws-sdk');
var crypto = require('crypto');

var env = fs.readFileSync(path.resolve(__dirname, 'fixtures', '.env'), 'utf8')
  .split('\n').reduce(function(env, line) {
    if (!line) return env;
    var bits = line.split('=');
    env[bits[0]] = bits[1];
    return env;
  }, {});

test('[runtime] service success', function(assert) {
  // move to fixtures dir to utilize .env fixture
  process.chdir(path.resolve(__dirname, 'fixtures'));

  var s3 = new AWS.S3();

  function service(records, callback) {
    assert.deepEqual(
      records,
      [
        {
          data: 'Hello, this is a test 123.',
          kinesisSchemaVersion: '1.0',
          partitionKey: 'partitionKey-3',
          sequenceNumber: '49545115243490985018280067714973144582180062593244200961'
        }
      ],
      'expected records passed to service'
    );

    Object.keys(env).forEach(function(key) {
      assert.equal(process.env[key], env[key], key + ' loaded in env');
    });

    assert.equal(typeof streambot.log.debug, 'function', 'provided log.debug function');
    assert.equal(typeof streambot.log.info, 'function', 'provided log.info function');
    assert.equal(typeof streambot.log.warn, 'function', 'provided log.warn function');
    assert.equal(typeof streambot.log.error, 'function', 'provided log.error function');
    assert.equal(typeof streambot.log.fatal, 'function', 'provided log.fatal function');

    streambot.log.info('successful');
    callback();
  }

  var context = {
    done: function(err, msg) {
      assert.ifError(err, 'no error reported to lambda');
      assert.equal(
        msg,
        'Processed events: shardId-000000000000:49545115243490985018280067714973144582180062593244200961',
        'expected message reported to lambda'
      );

      var s3url = {
        Bucket: 'mapbox-sandbox',
        Key: 'streambot-test-prefix/streambot-test/shardId-000000000000/49545115243490985018280067714973144582180062593244200961'
      };

      s3.getObject(s3url, function(err, data) {
        if (err) throw err;

        data.Body.toString().split('\n').forEach(function(line, i) {
          var re;
          if (i === 0) re = /\[.+?\] \[info\] \[streambot-test\] successful/;
          else if (line) return assert.fail('extra logs sent to S3');

          assert.ok(re.test(line), 'expected log sent to S3');
        });

        s3.deleteObject(s3url, function() {
          assert.end();
        });
      });
    }
  };

  streambot(service)(e(), context);
});

test('[runtime] no logs = nothing to s3', function(assert) {
  // move to fixtures dir to utilize .env fixture
  process.chdir(path.resolve(__dirname, 'fixtures'));

  var s3 = new AWS.S3();

  function service(records, callback) {
    assert.deepEqual(
      records,
      [
        {
          data: 'Hello, this is a test 123.',
          kinesisSchemaVersion: '1.0',
          partitionKey: 'partitionKey-3',
          sequenceNumber: '49545115243490985018280067714973144582180062593244200961'
        }
      ],
      'expected records passed to service'
    );

    Object.keys(env).forEach(function(key) {
      assert.equal(process.env[key], env[key], key + ' loaded in env');
    });

    assert.equal(typeof streambot.log.debug, 'function', 'provided log.debug function');
    assert.equal(typeof streambot.log.info, 'function', 'provided log.info function');
    assert.equal(typeof streambot.log.warn, 'function', 'provided log.warn function');
    assert.equal(typeof streambot.log.error, 'function', 'provided log.error function');
    assert.equal(typeof streambot.log.fatal, 'function', 'provided log.fatal function');

    callback();
  }

  var context = {
    done: function(err, msg) {
      assert.ifError(err, 'no error reported to lambda');
      assert.equal(
        msg,
        'Processed events: shardId-000000000000:49545115243490985018280067714973144582180062593244200961',
        'expected message reported to lambda'
      );

      var s3url = {
        Bucket: 'mapbox-sandbox',
        Key: 'streambot-test-prefix/streambot-test/shardId-000000000000/49545115243490985018280067714973144582180062593244200961'
      };

      s3.getObject(s3url, function(err, data) {
        if (data && data.Body) {
          assert.fail('Should not upload empty log to S3');
          s3.deleteObject(s3url, function() {
            assert.end();
          });
        } else {
          assert.pass('Does not upload empty log to S3');
          assert.end();
        }
      });
    }
  };

  streambot(service)(e(), context);
});

test('[runtime] required once, invoked multiple times', function(assert) {
  process.chdir(path.resolve(__dirname, 'fixtures'));
  var s3 = new AWS.S3();

  var expectedLog;
  function service(records, callback) {
    expectedLog = crypto.randomBytes(4).toString('hex');
    streambot.log.info(expectedLog);
    callback();
  }

  var fn = streambot(service);
  var firstEvent = e();
  var secondEvent = e();
  secondEvent.Records[0].kinesis.sequenceNumber = secondEvent.Records[0].kinesis.sequenceNumber.slice(0, -1) + '2';
  secondEvent.Records[0].eventID = secondEvent.Records[0].eventID.slice(0, -1) + '2';

  fn(firstEvent, { done: function() {

    var s3url = {
      Bucket: 'mapbox-sandbox',
      Key: 'streambot-test-prefix/streambot-test/shardId-000000000000/49545115243490985018280067714973144582180062593244200961'
    };

    s3.getObject(s3url, function(err, data) {
      if (err) throw err;
      var log = data.Body.toString().split('\n');
      assert.equal(log.length, 1, 'one line written');
      assert.ok((new RegExp(expectedLog + '$')).test(log[0]), 'proper log');

      s3.deleteObject(s3url, function() {
        fn(secondEvent, { done: function() {

          var s3url = {
            Bucket: 'mapbox-sandbox',
            Key: 'streambot-test-prefix/streambot-test/shardId-000000000000/49545115243490985018280067714973144582180062593244200962'
          };

          s3.getObject(s3url, function(err, data) {
            if (err) throw(err);
            var log = data.Body.toString().split('\n');
            assert.equal(log.length, 1, 'one line written');
            assert.ok((new RegExp(expectedLog + '$')).test(log[0]), 'proper log');

            s3.deleteObject(s3url, function() {
              assert.end();
            });
          });
        }});
      });
    });
  }});
});
