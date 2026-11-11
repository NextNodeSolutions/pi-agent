() {
	local scripts=${1:A:h}
	export ${(f)"$(<$scripts/dev-server.env)"}
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
