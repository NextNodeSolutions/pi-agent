# Every zsh of the machine sources this file, so it prints nothing and leaves the caller's options as they are.
() {
	emulate -L zsh
	local scripts=${1:A:h} assignment name
	[[ -r $scripts/dev-server.env ]] || return 0
	for assignment in ${(f)"$(<$scripts/dev-server.env)"}; do
		assignment=${assignment%$'\r'}
		name=${assignment%%=*}
		[[ $assignment == *=* && $assignment != *[[:space:]]* && $name == [A-Za-z_]* && $name != *[^A-Za-z0-9_]* ]] || continue
		# A value the caller already set stays, as it does in Pi, and is exported like one this file sets.
		[[ -v $name ]] && export $name || export $assignment
	done
	[[ -o interactive && -n $HC_TERMINAL_ID && -r $scripts/terminal.zsh ]] || return 0
	source $scripts/terminal.zsh
} ${(%):-%x}
