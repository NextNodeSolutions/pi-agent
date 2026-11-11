() {
	export ${(f)"$(<${1:A:h}/dev-server.env)"}
} ${(%):-%x}
