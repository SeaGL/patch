#!/bin/bash

# To get the right export, go to Pretalx.
#
# 1. In the sidebar, go to Schedule > Export.
# 2. JSON export.
# 3. Target group: confirmed.
# 4. Select the Proposal title field.
#
# Save, and pass the resulting JSON as the first arg. You'll need to massage/editorialize the output, but it's a nice start.
#
# TODO what to do about keynotes, social rooms, etc. - things that need special handling

set -euo pipefail

<$1 jq -r '.[] | "    " + .ID + ": " + (
	."Proposal title" 

	# Strip the second component of titles, such as in "Project Name: How XYZ is Happening"
	| gsub("(- |:) [[:alnum:] -]+$"; "")
	# Strip non-alphanumeric, leaving spaces
	| gsub("[^[:alnum:] ]"; "")

	# Upcase the first of each word and strip spaces
	/ " " | map((.[:1]|ascii_upcase) + (.[1:])) | join("")
) + " # " + ."Proposal title"'
