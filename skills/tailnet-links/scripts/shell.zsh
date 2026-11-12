# Every zsh of the machine sources this file, so it prints nothing and leaves the caller's options as they are.
() {
	emulate -L zsh
	local scripts=${1:A:h} assignment name
	[[ -r $scripts/dev-server.env ]] || return 0
	for assignment in ${(f)"$(<$scripts/dev-server.env)"}; do
		assignment=${assignment%$'\r'}
		name=${assignment%%=*}
		[[ $assignment == *=* && $name == [A-Za-z_]* && $name != *[^A-Za-z0-9_]* ]] || continue
		# A value the caller already set stays, as it does in Pi.
		[[ -v $name ]] || export $assignment
	done
	[[ -o interactive && -n $HC_TERMINAL_ID ]] || return 0
	zmodload zsh/zselect
	typeset -g _tailnet_link_command=$scripts/tailnet-link _tailnet_link_announcer= _tailnet_link_start_centiseconds=100
	autoload -Uz add-zsh-hook
	add-zsh-hook preexec _tailnet_link_announce
	add-zsh-hook precmd _tailnet_link_silence
} ${(%):-%x}

# The wait happens in the shell, so a command that ends at once starts no watcher.
_tailnet_link_announce() {
	( zselect -t $_tailnet_link_start_centiseconds; exec $_tailnet_link_command announce ) &!
	_tailnet_link_announcer=$!
}

_tailnet_link_silence() {
	[[ -n $_tailnet_link_announcer ]] && kill $_tailnet_link_announcer 2>/dev/null
	_tailnet_link_announcer=
}
