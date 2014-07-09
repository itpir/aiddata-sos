var csv = require('csv');
var url = require('url');
var S = require('string');
var ss = require('simple-statistics');
var md5 = require('MD5');
var natural = require('natural');
var keyword_extractor = require("keyword-extractor");
var bayes = require('bayes');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;

console.log("CPUS: "+numCPUs);

var header = true;
var gsz = 0;

/***************************
GET THE COMMAND LINE VARS
****************************/
/* get the training file name from command line */
var csvfile = process.argv[2];

/* get the training size */
var MAX_NEG = Math.max(process.argv[3],100);

console.log(csvfile);

var weakClassifiers = [];

var training_data = [];

var total_count = 0;

Array.prototype.sumvotes = function() {
    var a = this.concat();
    for(var i=0; i<a.length; ++i) 
    {
        for(var j=i+1; j<a.length; ++j) 
        {
            if(a[i].category === a[j].category)
            {
            	s = a[i].vote+a[j].vote;
            	a[i].nVotes += a[j].nVotes;
            	a[i].vote += a[j].vote;
                a.splice(j, 1); 
            }
        }
    }
    return a;
};

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
	if (array[pivot].act_code === act_code)
	{
		while (pivot >= 0 && array[pivot].act_code == act_code)
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
	if (array[pivot].act_code < act_code) 
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
	var index = locationOfActCode(code, training_data);
	
	bFound = false;
	while ((index < training_data.length) && (training_data[index].act_code === code) && (bFound == false))
	{
		if ( training_data[index].id === id)
		{
			bFound = true;
			break;
		}
		index++;
	}

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
 	text = S(text).humanize().s
 	text = text.toLowerCase(text);
 
 	return text;
}

csv().from.path(csvfile, { columns: true, delimiter: "\t" } )

// on each record, populate the map and check the codes
.on('record', function (data, index) 
{
	if (header)
    {
    	strHeader ='';
    	for (key in data)
    	{	
 			strHeader += key+'|';	
 		}
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
			count: 0,
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
				weakClassifiers[y].count++;
				bFound = true;
			}
		}
		if (!bFound)
		{
  			var cl = new natural.BayesClassifier();
			//var cl = bayes();
			cl.pos = 0;
			cl.neg = 0;
			cl.count = 1;
			cl.act_code = training_data[c].act_code;
			weakClassifiers.push(cl);
		}
	}
	
	console.log("Codes Found: "+weakClassifiers.length);
	
	console.log("Training Codes.");	
	
	//sort by activity code
	training_data.sort(function(a, b){	
		return a.act_code.localeCompare(b.act_code);
	});
	t = 0;
	
	while (stillTraining())
	{
		r = Math.floor(Math.random()*gsz);
		if (((t+1) % 1000) == 0)
		{
			console.log(t+1);
			global.gc();
		}
		txt = training_data[r].text;
		for (var y = 0; y < weakClassifiers.length; y++)
		{
			if ((training_data[r].act_code != weakClassifiers[y].act_code) && (weakClassifiers[y].neg < MAX_NEG))
			{
				//console.log('finding');
				bF = codeInProj(weakClassifiers[y].act_code,training_data[r].id, training_data);
				if (bF == false)
				{
					//console.log('classifying');
					weakClassifiers[y].neg++;
					learnWeak(y, txt, "-");
				}
			}
		}
		t++;
	}
	console.log("Start Training.");
	for (var y = 0; y < weakClassifiers.length; y++)
	{
		console.log("Training Classifier for: " + weakClassifiers[y].act_code);
		weakClassifiers[y].train();
	}
	console.log("End Training.");
	
	console.log("Start Saving Classifiers");
	for (var y = 0; y < weakClassifiers.length; y++)
	{
		console.log("Saving Classifier for: " + weakClassifiers[y].act_code);
		f = weakClassifiers[y].act_code+".json"
		c = weakClassifiers[y];
		weakClassifiers[y].save(f, function(err, c) 
		{
    		// the classifier is saved to the act_code.json file
		});
	}

})




