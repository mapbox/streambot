var test = require('tape');
var streambot = require('..');
var e = require('./fixtures/event.json');
var path = require('path');
var fs = require('fs');
var AWS = require('aws-sdk');

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
        Bucket: 'mapbox',
        Key: 'streambot-test-prefix/streambot-test/shardId-000000000000/49545115243490985018280067714973144582180062593244200961'
      };

      s3.getObject(s3url, function(err, data) {
        if (err) throw err;

        data.Body.toString().split('\n').forEach(function(line, i) {
          var re;
          if (i === 0) re = /\[.+?\] \[info\] \[streambot-test\] \{"Records":\[\{"kinesis":\{"partitionKey":"partitionKey-3","kinesisSchemaVersion":"1.0","data":"SGVsbG8sIHRoaXMgaXMgYSB0ZXN0IDEyMy4=","sequenceNumber":"49545115243490985018280067714973144582180062593244200961"\},"eventSource":"aws:kinesis","eventID":"shardId-000000000000:49545115243490985018280067714973144582180062593244200961","invokeIdentityArn":"arn:aws:iam::059493405231:role\/testLEBRole","eventVersion":"1.0","eventName":"aws:kinesis:record","eventSourceARN":"arn:aws:kinesis:us-east-1:35667example:stream\/examplestream","awsRegion":"us-east-1"\}\]\}/;
          else if (i === 1) re = /\[.+?\] \[info\] \[streambot-test\] successful/;
          else if (i === 2) re = /\[streambot-test\] putMetricData \{"Namespace":"streambot","MetricData":\[\{"MetricName":"streambot-test-metric","Value":1,"Dimensions":\[\{"Name":"Status","Value":"Success"\}\]\}\]\}/;
          else if (line) return assert.fail('extra logs sent to S3');

          assert.ok(re.test(line), 'expected log sent to S3');
        });

        s3.deleteObject(s3url, function() {
          assert.end();
        });
      });
    }
  };

  streambot(service)(e, context);
});
