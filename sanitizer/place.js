
var sanitizeAll = require('../sanitizer/sanitizeAll'),
    sanitizers = {
      singleScalarParameters: require('../sanitizer/_single_scalar_parameters')(),
      debug: require('../sanitizer/_debug')(),
      ids: require('../sanitizer/_ids')(),
      lang: require('../sanitizer/_lang')(),
      private: require('../sanitizer/_flag_bool')('private', false)
    };

// middleware
module.exports.middleware = function(req, res, next){
  sanitizeAll.runAllChecks(req, sanitizers);
  next();
};
