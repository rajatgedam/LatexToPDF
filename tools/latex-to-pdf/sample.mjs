// Known-good XeTeX-compatible example (also served by `toolmaster sample latex-to-pdf` and the web app's "Load sample").
export const SAMPLE = String.raw`\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{\vspace{-4pt}\scshape\raggedright\large}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}
\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}

\begin{center}
    {\Huge \scshape Alex Sample} \\ \vspace{1pt}
    \small 555-010-0199 $|$ \href{mailto:alex@example.com}{alex@example.com} $|$
    \href{https://example.com/alex}{example.com/alex} $|$
    \href{https://github.com/example}{github.com/example}
\end{center}

\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Example State University}{Aug. 2018 -- May 2022}
      {B.S. in Computer Science}{Example City, ST}
  \resumeSubHeadingListEnd

\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Software Engineer}{Jun. 2022 -- Present}
      {Example Corp}{Remote}
      \resumeItemListStart
        \resumeItem{Built a document pipeline that cut report generation time by 40\% across 12 teams.}
        \resumeItem{Introduced automated testing with 85\% coverage; reduced regressions release over release.}
      \resumeItemListEnd
  \resumeSubHeadingListEnd

\section{Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Languages}{: JavaScript, Python, SQL} \\
     \textbf{Tools}{: Git, Docker, CI/CD}
    }}
 \end{itemize}

\end{document}
`;
