var fuzzy = require('fuzzy.js');

var stringUtils = require('../helper/stringUtils');
var normalize = stringUtils.normalize;
var removeSpaces = stringUtils.removeSpaces;


// fuzzy.js score range is not normalized but depends on string length as computed below
// NOTE: recheck whenever updating fuzzy.js version!
function getMaxScore(len) {
  return 3*(len - 1) + 1;
}


/* returns 1.0 only when strings are identical
   Totally different strings return 0.
   Original fuzzyjs prefers strings with a similar start.
   Here that limitation is cured by evaluating score from
   direct substring match. For example, 'citymarket' is not a bad
   match with 'k-citymarket' or even with 'turtolan k-citymarket'.
   Hopefully a proper fuzzy match library will be found.
   Meanwhile, we patch the worst faults ourselves.
*/

function _fuzzyMatch(text1, text2) {
  // at the lowest match level, consider spaces insignificant. east west pub = eastwestpub
  text1 = removeSpaces(text1);
  text2 = removeSpaces(text2);

  var len1 = text1.length;
  var len2 = text2.length;

  var fscore = fuzzy(text1, text2).score;
  var score = fscore/getMaxScore(len1); // normalized 0 .. 1 score
  var score2; // alternative scoring by direct substring match

  if (len1>=len2) {
    if(text1.indexOf(text2)!==-1) {
      score2 = len2/len1;
    }
  } else {
    // do not punish from missing tail part too much ...
    var minScore = fscore/getMaxScore(len1 + 1);
    var key = len1/len2;
    // Interpolate final score. The more missing chars, the lower the score
    score = key*score + (1-key)*minScore;

    var subIndex = text2.indexOf(text1);
    if(subIndex !== -1) {
      score2 = len1/(len2 + subIndex); // favor match at start
    }
  }
  if (score2 && score2>score) {
    return score2;
  }

  return score;
}

// matching which takes word order into account
function fuzzyMatch(text1, text2) {
  text1 = normalize(text1);
  text2 = normalize(text2);

  // straight match as a whole string
  var score = _fuzzyMatch(text1, text2);

  // consider change of order e.g. Citymarket turtola | Turtolan citymarket
  // In normal text, change of order can be very significant. With addresses,
  // order does not matter that much.
  var words1 = text1.split(' ');
  var words2 = text2.split(' ');

  if(words1.length>1 || words2.length>1) {
    if(words1.length>words2.length) {
      var temp = words1;
      words1 = words2;
      words2 = temp;
    }
    var wordScore=0;
    var weightSum=0;
    var matched=[];
    words1.forEach(function(word1) {
      var bestScore=0, bestIndex;
      for(var wi in words2) {
        var wscore = _fuzzyMatch(word1, words2[wi]);
        if (wscore>bestScore) {
          bestScore=wscore;
          bestIndex = wi;
        }
      }
      var l = word1.length;
      wordScore += l*bestScore; // weight by word len
      weightSum += l;
      matched[bestIndex]=true;
    });

    // extra words just accumulate weight, not score
    for (var wi2 in words2) {
      if (!matched[wi2]) {
        weightSum += words2[wi2].length;
      }
    }
    wordScore /= weightSum;
    if(wordScore>score) {
      return wordScore;
    }
  }
  return score;
}

/* find best match from an array of values */
function fuzzyMatchArray(text, array) {
  var maxMatch = 0;
  array.forEach( function(text2) {
    var match = fuzzyMatch(text, text2);
    if (match>maxMatch) {
      maxMatch=match;
    }
  });
  return maxMatch;
}

module.exports = { match: fuzzyMatch,
                   matchArray: fuzzyMatchArray
                 };
