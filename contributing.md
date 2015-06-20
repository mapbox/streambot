## Documented CloudFormation templates

The repository contains JavaScript files defining Streambot's template and an example template. Edit these files in order to make changes to the templates that are produced via the library's build script: `npm run-script build`.

## Documentation

Is built using [docco](http://jashkenas.github.io/docco/). Use `//` to write comments in JavaScript files, and format your comments with Markdown syntax. Rebuild the documentation via `npm run-script docs` (to only build documentation) or `npm run-script build` (to build the whole project).

## Travis

Travis is used to bundle code and put it on S3 with its ACL set to `public-read`. It makes two `.zip` files, one containing nothing but the `index.js` file defining Streambot's wrapper and Lambda functions, and another representing the bundled streambot-example.

Travis also runs basic tests that do not require an AWS permissions to complete.

## Tests

- `test/*.test.js` files run unit tests that do not require AWS credentials.
- `test/live-test.js` can be run by users with permissions to Mapbox AWS Infrastructure. This script is an integration test that runs the streambot-example stack and confirms that its Lambda function is able to do what it is expected to do.
