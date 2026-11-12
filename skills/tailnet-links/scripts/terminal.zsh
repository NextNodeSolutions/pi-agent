# shell.zsh sources this file in a Herdr terminal where a human types commands.
{ zmodload zsh/zselect zsh/datetime && zmodload -F zsh/files b:zf_mkdir b:zf_rm } 2>/dev/null || return 0
typeset -g _tailnet_link_command=${${(%):-%x}:A:h}/tailnet-link _tailnet_link_start_centiseconds=100
# The watcher counts each URL over the same span at every reading, wider than the history a Herdr terminal keeps.
typeset -g _tailnet_link_history_lines=10000
typeset -g _tailnet_link_record=$HOME/.local/state/tailnet-link/commands/$$
zf_mkdir -p ${_tailnet_link_record:h} 2>/dev/null || return 0
# A shell that ended through exec or a kill ran no exit hook, so the next terminal removes the record it left.
for _tailnet_link_left in ${_tailnet_link_record:h}/*(N); do
	kill -0 ${_tailnet_link_left:t} 2>/dev/null || zf_rm -f $_tailnet_link_left 2>/dev/null
done
unset _tailnet_link_left

# The shell tells its watcher that the command ended by rewriting a file, and never by a signal: the watcher may have
# ended long before, and its process number may be another program's by then.
_tailnet_link_announce() {
	emulate -L zsh
	local serial=$EPOCHREALTIME
	{ print -r -- $serial >| $_tailnet_link_record } 2>/dev/null || return 0
	# A process substitution starts the watcher and leaves $! to the background jobs the human starts.
	: <(
		# Without job control the watcher shares the shell's process group, where the interrupt and suspend keys reach it.
		trap '' INT QUIT TSTP
		local shown
		{
			# Without this reading every URL of the terminal would look new, so a read that fails starts no watcher.
			shown="$(hc read $HC_TERMINAL_ID --lines $_tailnet_link_history_lines)" && {
				# The wait happens here, so a command that ends at once starts no watcher.
				zselect -t $_tailnet_link_start_centiseconds
				[[ $(<$_tailnet_link_record) == $serial ]]
			}
		} 2>/dev/null && exec $_tailnet_link_command announce $$ $_tailnet_link_record $serial $_tailnet_link_history_lines \
			>/dev/null <<< $shown
	)
}

_tailnet_link_silence() {
	emulate -L zsh
	{ : >| $_tailnet_link_record } 2>/dev/null
}

# zsh also runs its exit hooks in a subshell that calls exit, and the record belongs to the shell that stays.
_tailnet_link_forget() {
	emulate -L zsh
	(( ZSH_SUBSHELL )) || zf_rm -f $_tailnet_link_record 2>/dev/null
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _tailnet_link_announce
add-zsh-hook precmd _tailnet_link_silence
add-zsh-hook zshexit _tailnet_link_forget
