import jenkins.model.Jenkins
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition
import hudson.model.StringParameterDefinition
import hudson.model.ChoiceParameterDefinition
import hudson.model.ParametersDefinitionProperty

def name = 'asdlc-pr'
def script = '''
pipeline {
  agent any
  parameters {
    string(name: 'CHANGE_ID', defaultValue: 'TECH-3001')
    choice(name: 'MODE', choices: ['lint', 'gate'], description: 'lint = spec PR; gate = implementation PR')
    string(name: 'REPO', defaultValue: 'english-learning-agent')
  }
  stages {
    stage('asdlc') {
      steps {
        script {
          def asdlc = 'node /workspace/toolkit/bin/asdlc.js'
          if (params.MODE == 'gate') {
            sh "cd /workspace/project && ${asdlc} gate ${params.CHANGE_ID} --repo ${params.REPO}"
          } else {
            sh "cd /workspace/project && ${asdlc} lint ${params.CHANGE_ID}"
          }
        }
      }
    }
  }
  post {
    always {
      script {
        withEnv([
          "STATE=" + (currentBuild.currentResult == 'SUCCESS' ? 'success' : 'failure'),
          "CONTEXT=asdlc/" + params.MODE,
          "TARGET_URL=" + currentBuild.absoluteUrl,
          "PROJECT_DIR=/workspace/project",
        ]) {
          sh 'sh /workspace/toolkit/jenkins/github-status.sh || true'
        }
      }
    }
    success { echo "asdlc ${params.MODE} PASSED for ${params.CHANGE_ID}" }
    failure { echo "asdlc ${params.MODE} FAILED for ${params.CHANGE_ID}" }
  }
}
'''

def j = Jenkins.get()
if (j.getItem(name) == null) {
  def job = j.createProject(WorkflowJob, name)
  def params = [
    new StringParameterDefinition('CHANGE_ID', 'TECH-3001', ''),
    new ChoiceParameterDefinition('MODE', (['lint', 'gate'] as String[]), 'lint = spec PR; gate = implementation PR'),
    new StringParameterDefinition('REPO', 'english-learning-agent', ''),
  ]
  job.addProperty(new ParametersDefinitionProperty(params))
  job.setDefinition(new CpsFlowDefinition(script, true))
  job.save()
  println("[asdlc] created parameterized job ${name}")
}
