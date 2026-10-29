export const SAMPLE = String.raw`\documentclass{article}
\title{Quarterly Report}
\author{Alex Sample}
\begin{document}
\maketitle

\section{Highlights}
Revenue grew \textbf{12\%} this quarter, driven by three things:
\begin{itemize}
  \item A faster \emph{onboarding} flow
  \item Fewer support tickets
  \item Two new partnerships
\end{itemize}

\section{Numbers}
\begin{tabular}{lrr}
  Region & Q1 & Q2 \\
  North  & 120 & 135 \\
  South  & 98  & 110 \\
\end{tabular}

\subsection{Formula}
Growth is $g = \frac{Q_2 - Q_1}{Q_1}$.

\end{document}
`;
