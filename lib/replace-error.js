/**
* Coming from https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
* @example
*  console.log(JSON.stringify(error, replaceErrors));
*/

module.exports = function (key, value) {
	if (value instanceof Error) {
		const error = {};
		for (const key of Object.getOwnPropertyNames(value)) {
			error[key] = value[key];
		}

		return error;
	}

	return value;
};
