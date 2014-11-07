var csv = require('csv');
var url = require('url');
var S = require('string');
var ss = require('simple-statistics');
var md5 = require('MD5');
var natural = require('natural');
var keyword_extractor = require('keyword-extractor');
var header = true;
var gsz = 0;

/***************************
GET THE COMMAND LINE VARS
****************************/
/* get the training file name from command line */
var csvfile = process.argv[2];

/* get the training size */
var MAX_NEG = Math.max(process.argv[3],100);
var MIN_POS = 1;

console.log(csvfile);

var weakClassifiers = [];

var training_data = [];

function insertIntoTraining(rec,training_data)
{
	i = locationOf(rec,training_data);
	if (i > 0)
	{
		if (training_data[i].coderulemd5 != rec.coderulemd5)
		{
			insert (rec, training_data);
		}
		else
		{
			training_data[i].count = training_data[i].count+1;
		}
	}
	else
	{
		insert (rec, training_data);
	}
}

function insert(element, array) 
{
	array.splice(locationOf(element, array) + 1, 0, element);
  	return array;
}

function locationOf(element, array, start, end) 
{
	if (array.length == 0) {
		return 0;
	}
	start = start || 0;
	end = end || array.length;
	var pivot = parseInt(start + (end - start) / 2, 10);
	if (array[pivot].coderulemd5 === element.coderulemd5)
	{
		return pivot;
	}
	if (end - start <= 1) 
	{
		return array[pivot].coderulemd5 > element.coderulemd5 ? pivot - 1 : pivot;
	}
	if (array[pivot].coderulemd5 < element.coderulemd5) 
	{
		return locationOf(element, array, pivot, end);
	} 
	else 
	{
		return locationOf(element, array, start, pivot);
	}
}

function locationOfActCode(act_code, array, start, end) 
{
	if (array.length == 0) {
		return 0;
	}
	start = start || 0;
	end = end || array.length;
	var pivot = parseInt(start + (end - start) / 2, 10);
	//console.log(act_code+" "+(array[pivot].act_code+array[pivot].id));
	if ((array[pivot].act_code+array[pivot].id) === act_code)
	{
		while (pivot >= 0 && (array[pivot].act_code+array[pivot].id) == act_code)
		{
			pivot--;
		}
		pivot++;
		return pivot;
	}
	if (end - start <= 1) 
	{
		return 0;
	}
	if ((array[pivot].act_code+array[pivot].id) < act_code) 
	{
		return locationOfActCode(act_code, array, pivot, end);
	} 
	else 
	{
		return locationOfActCode(act_code, array, start, pivot);
	}
}

function locationOfProjCode(projcodemd5, array, start, end) 
{
	if (array.length == 0) {
		return 0;
	}
	start = start || 0;
	end = end || array.length;
	var pivot = parseInt(start + (end - start) / 2, 10);
	if (array[pivot].projcodemd5 === projcodemd5)
	{
		return 1;
	}
	if (end - start <= 1) 
	{
		return 0;
	}
	if (array[pivot].projcodemd5 < projcodemd5) 
	{
		return locationOfProjCode(projcodemd5, array, pivot, end);
	} 
	else 
	{
		return locationOfProjCode(projcodemd5, array, start, pivot);
	}
}

function learnWeak(i,text,code)
{	
	weakClassifiers[i].addDocument(text, code);
}

function isNumber(n) 
{
  x = +n;
  return !isNaN(parseFloat(x)) && isFinite(x);
}

function featureSelect (text)
{
	var txtArr = keyword_extractor.extract(text,{
			language:"english",
			return_changed_case:false
		});
	
	text = '';
	for (g = 0; g < txtArr.length; g++)
	{
		if (!isNumber(txtArr[g]))
			text += txtArr[g]+' ';
	} 
	return txtArr;
	
}


function codeInProj(code,id, training_data)
{
	var index = locationOfActCode((code+id), training_data);
	//console.log(index);
	
	bFound = (index > 0);
	return bFound;
}


function everybodyVotes(classVoters,input_string)
{
	var ans = [];
	
	var allvotes = [];
	for (var v = 0; v < classVoters.length; v++)
	{
		allvotes.push(classVoters[v][0]);
		allvotes[v].act_code = 	classVoters[v].act_code;
	}

	allvotes.sort(function(a, b){
				return a.value-b.value;
			});
		
	return allvotes;

}

/***********************************************************
stillTraining()

params: none

purpose:
check to see if we are still training
we are still training if we havent seen enough negative examples
and and havent seen enough positive examples, either

returns: boolean , true if we are still not finished training
************************************************************/
function stillTraining()
{
	var f = false;
	for (var t = 0; t < weakClassifiers.length; t++)
	{
		if (weakClassifiers[t].neg < MAX_NEG)
		{
			f = true;
			break;
		}
	}
	
	return f;
}

function cleanText (text)
{
	text = text.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g," ");
	text = S(text).stripTags().s;
 	text = S(text).humanize().s;
 	text = text.toLowerCase(text);
 
 	return text;
}

csv().from.path(csvfile, { columns: true, delimiter: "\t" } )

// on each record, populate the map and check the codes
.on('record', function (data, index) 
{
	if (header)
    {
 		header = false;	
 	}
 	else
 	{
		strRow ='';
		act_code ='';
		title ='';
		short_desc ='';
		long_desc ='';
		project_id = '';
		for (key in data)
		{	
			var rec;
			data[key] = data[key].trim();
			if (key == 'act_code')
			{
				act_code = data[key];    
			}
			 if (key == 'project_id')
			{
				project_id = data[key];
			}
			if (key == 'title') 
			{
				title = data[key];
			}
			if (key == 'short')
			{
				short_desc = data[key];
			}
			if (key == 'long')
			{
				long_desc = data[key];
			}	  
		}
		
		strRow = title+" "+short_desc+" "+long_desc;
		
		//clean up the fields
		text = cleanText(strRow);
		text = featureSelect(text);
		
		var rec = {
			act_code: act_code,
			id : project_id,
			text : text,
			coderulemd5: md5(text+act_code),
			projcodemd5: md5(project_id+act_code)
		};
				
		if( (index % 1000) == 0)
		{
			console.log("Seen "+index+" coded projects.");
		}
		
		if (text.length > 0)
			insertIntoTraining(rec,training_data);
	}
 })
 
 .on('end', function(count){
    console.log("Done Reading.");
    console.log("Finding Codes.");
    gsz = training_data.length;
    for (var c = 0; c < gsz; c++)
    {
    	bFound = false;
    	
		for (var y = 0; y < weakClassifiers.length; y++)
		{
			if (weakClassifiers[y].act_code == training_data[c].act_code)
			{
				bFound = true;
			}
		}
		if (!bFound)
		{
  			var cl = new natural.BayesClassifier();
			cl.neg = 0;
			cl.pos = 0;
			cl.act_code = training_data[c].act_code;
			weakClassifiers.push(cl);
		}
	}
	
	var lClasses = weakClassifiers.length;
	var perCode = Math.ceil(MAX_NEG/lClasses);	
	MIN_POS = perCode;
	console.log("Minimum Positive Class Size: "+MIN_POS);
	console.log("Codes Found: "+lClasses);
	console.log("Training Codes.");
	
	//sort by activity code+proj_id
	training_data.sort(function(a, b)
	{	
		i1 = a.act_code+a.id;
		i2 = b.act_code+b.id;
		return i1.localeCompare(i2);
	});
	
	//train the positive examples, as negative examples across all the classes
	for (var f = 0; f < lClasses; f++)
	{
		v = f + 1;
		console.log("\tTraining Classifier for: " + weakClassifiers[f].act_code+" ("+v+" of "+weakClassifiers.length+"), Stage #1");
		theseCodes = training_data.filter(function (el) {
			return el.act_code == weakClassifiers[f].act_code;
		});
		
		var c = 0;
		while (c < perCode)
		{
			r = Math.floor(Math.random()*theseCodes.length);
			txt = theseCodes[r].text;
			for (var y = 0; y < weakClassifiers.length; y++)
			{
				if (theseCodes[r].act_code != weakClassifiers[y].act_code)
				{
					bF = codeInProj(weakClassifiers[y].act_code,theseCodes[r].id, training_data);
					if (bF == false)
					{
						weakClassifiers[y].neg++;
						learnWeak(y, txt, "-");
					}
				}
				if (theseCodes[r].act_code == weakClassifiers[y].act_code) 
				{
					weakClassifiers[y].pos++;	
				}
			}
			c++;
		}
	}
	
	//stage #2, fill in any negative examples with random samples from the training data.
	
	t = 0;
	while (stillTraining())
	{	
		r = Math.floor(Math.random()*gsz);
		txt = training_data[r].text;
		for (var y = 0; y < weakClassifiers.length; y++)
		{
			v = y + 1;
			console.log("\tTraining Classifier for: " + weakClassifiers[y].act_code+" ("+v+" of "+weakClassifiers.length+"), Stage #2");
			if ((training_data[r].act_code != weakClassifiers[y].act_code) && (weakClassifiers[y].neg < MAX_NEG))
			{
				bF = codeInProj(weakClassifiers[y].act_code,training_data[r].id, training_data);
				if (bF == false)
				{
					weakClassifiers[y].neg++;
					learnWeak(y, txt, "-");
				}
			}
			if (training_data[r].act_code == weakClassifiers[y].act_code) 
			{
				weakClassifiers[y].pos++;	
			}
		}
		t++;
	}
	for (var y = 0; y < weakClassifiers.length; y++)
	{
		v = y+1;
		console.log("\tTraining Classifier for: " + weakClassifiers[y].act_code+" ("+v+" of "+weakClassifiers.length+"), Stage #3");
		weakClassifiers[y].train();
	}
	console.log("End Training.");
	
	console.log("Start Saving Classifiers.");
	for (var y = 0; y < weakClassifiers.length; y++)
	{
		v = y+1;
		console.log("\tSaving Classifier for: " + weakClassifiers[y].act_code+" ("+v+" of "+weakClassifiers.length+")");
		f = weakClassifiers[y].act_code+".json"
		c = weakClassifiers[y];
		weakClassifiers[y].save(f, function(err, c) 
		{
    		// the classifier is saved to the act_code.json file
		});
	}
	console.log("End Saving Classifiers.");

})




