aiddata-sos
===========

Implementation of a complementary naive bayes for activity coding

To train:

node --expose-gc --max-old-space_size=8192 bayes_harness.js [trainingdataset] [number to train]

a sample trainingdataset is in the training_data folder (trainset.csv). Please email sstewart@aiddata.org for larger training sets

number_to_train is the max number of complementary examples to train against for each code (higher is better but takes much more time)

This will create a set of json files for each activity code. Copy these json files to a directory
and run the cluster_classifier against it

node --max-old-space-size=8192 cluster_classifier.js [jsondirectory\]

NOTE THAT THE TRAILING SLASH IS REQUIRED

This will load the serialized classifiers and start a webserver on port 8081

the json_1000 folder in the training_data folder contains a sample serialized set of 1000 negative examples for each code

to classify issue:

http://localhost:8081/?description=text_to_classify


