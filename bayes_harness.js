var csv = require('csv');
var url = require('url');
var S = require('string');
var ss = require('simple-statistics');
var md5 = require('MD5');
var natural = require('natural');
var keyword_extractor = require("keyword-extractor");
var bayes = require('bayes');

var header = true;
var gsz = 0;

/***************************
GET THE COMMAND LINE VARS
****************************/
/* get the training file name from command line */
var csvfile = process.argv[2];
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
	text = featureSelect(text);
	weakClassifiers[i].learn(text,code);
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
		text += txtArr[g]+' ';
	}
	
	return text;
	
}

function getMad(votes)
{
	var ar = [];
	for (var y = 0;  y < votes.length; y++)
	{
		ar.push(votes[y].probability);
	}
	var mad = ss.mad(ar);
	return mad;
}

function getMedian(votes)
{
	var ar = [];
	for (var y = 0; y < votes.length; y++)
	{
		ar.push(votes[y].probability);
	}
	var median = ss.median(ar);
	return median;
}


function getCodesbyJenks(votes, classes)
{
	var ar = [];
	var ans = [];
	for (var y = 0;  y < votes.length; y++)
	{
		ar.push(votes[y].probability);
	}
	
 	var jenks = ss.jenks(ar, classes);

 	var f = 0;
 	while (f < votes.length && (votes[f].probability >= jenks[0] &&  votes[f].probability <= jenks[1]))
 	{
 		ans.push(votes[f]);
 		console.log(votes[f]);
 		f++;	
 	}
	
	return ans;
	
}


function getCodesbyMAD(votes, thold)
{
	var ans = [];
	l = votes.length;

	var mad = getMad(votes);
	var medianvotes = getMedian(votes);
	outlier = thold;
	
	console.log("\t\tActivity Code\t\t\tRAW Vote\t\t\t\tMAD Vote\t\t\tMAD Threshold");
	var y = 0;
	while (y < votes.length)
	{	
		votes[y].Mi = ((0.6745) * Math.abs(votes[y].probability - medianvotes))/mad;
		
		if (typeof votes[y] != 'undefined' && Math.abs(votes[y].Mi) >= outlier)
		{
			console.log("\t\t"+votes[y].act_code+"\t\t\t"+votes[y].probability+"\t\t\t"+votes[y].Mi+"\t\t\t\t"+outlier);
			ans.push(votes[y]);
		}
		else if (votes[y].Mi <= outlier)  //only single handed test
		{
			break;
		}
		y++;
	}
	if (ans.length == 0 && votes.length > 0)
	{
		console.log("\t\t"+votes[0].act_code+"\t\t\t"+votes[0].probability+"\t\t\t"+votes[0].Mi+"\t\t\t\t"+outlier);
		ans.push(votes[0]);
	}
	return ans;
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
				return a.probability-b.probability;
			});
		
	return allvotes;

}

function stillTraining()
{
	var f = false;
	for (var t = 0; t < weakClassifiers.length; t++)
	{
		if ( weakClassifiers[t].neg < (gsz/4) && weakClassifiers[t].neg < 20000)
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
			var cl = bayes();
			cl.pos = 0;
			cl.neg = 0;
			cl.count = 1;
			cl.act_code = training_data[c].act_code;
			weakClassifiers.push(cl);
		}
	}
	
	console.log("Codes Found: "+weakClassifiers.length);
	
	console.log("Sorting Codes.");
	
	training_data.sort(function(a, b){	
			return a.projcodemd5.localeCompare(b.projcodemd5);
		});
	
	console.log("Training Codes.");	
	
	//sort by activity code
	training_data.sort(function(a, b){	
		return a.act_code.localeCompare(b.act_code);
	});
	t = 0;
	
	while (stillTraining())
	{
		r = Math.floor(Math.random()*gsz);
		if (((t+1) % 100) == 0)
		{
			console.log(t+1);
			global.gc();
			
		}
		txt = featureSelect(training_data[r].text);
		for (var y = 0; y < weakClassifiers.length; y++)
		{
			if ((training_data[r].act_code != weakClassifiers[y].act_code) && (weakClassifiers[y].neg < (gsz/4)) && (weakClassifiers[y].neg < 20000))
			{
				bF = codeInProj(weakClassifiers[y].act_code,training_data[r].id, training_data);
				if (bF == false)
				{
					weakClassifiers[y].neg++;
					learnWeak(y, txt, -1);
				}
			}
		}
		t++;
	}
	console.log("End Training.");
	
})

var sys = require("sys");
	
	var my_http = require("http");
	my_http.createServer(function(req,res){
	
		var body = "";
  		req.on('data', function (chunk) {
    		body += chunk;
  		});
  		
  		//parse the input string, get text, sector, donor and recipient
  		var queryData = url.parse(req.url, true).query;
  		orig_input_string = queryData.description;			//get the text to classify from the querystring
  		id = queryData.id;
  		
  		mode = queryData.mode;
  		thold = queryData.thold;
  		input_string = cleanText(orig_input_string);
  		
  		//handle request
  		req.on('end', function () {
    	
    		//answer array
    		var ans =[];
    			
			//check to see if the classifier is ready (has read all the training input)
			
			console.log("Project: " +id);
			
			var test = null;
			var nCodes = 0;
			var nProjs = 0;
					
			//if we have all of our good classes to attempt classification with
			var classVoters = [];
		
			for (var r = 0; r < weakClassifiers.length; r++)
			{
				txt = featureSelect(input_string);
				test = weakClassifiers[r].categorize_list(txt);
				test.act_code =  weakClassifiers[r].act_code;
				classVoters.push(test);	
			}		
			
			var votes = everybodyVotes(classVoters, input_string);
		
			if (mode == 1)
				ans = getCodesbyMAD(votes, thold);
			else if (mode == 2)
				ans = getCodesbyJenks(votes, thold);
			else
				ans = getCodesbyMAD(votes, 5.2);
		
			res.writeHeader(200, {"Content-Type": "text/json"});
			res.write(JSON.stringify(ans));
			console.log("\t-----------------------------------------------");				
				
			res.end();
	});

}).listen(8081);
sys.puts("Server Running on 8081");	
 

